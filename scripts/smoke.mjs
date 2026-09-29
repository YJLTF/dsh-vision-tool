// Smoke test: boot the built `lib/index.js` against a minimal fake Host and
// walk the plugin's whole surface — volatile config read, admission-gate relax,
// tool registration, guidance decisions (including mid-session model switch),
// the `understand_image` happy paths, and clean unwind. Run after `pnpm build`:
//   node scripts/smoke.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { apply, Config } = await import(new URL('../lib/index.js', import.meta.url))

const volatile = Config['~standard'].validate({})
assert.ok(!volatile.issues, 'Config schema validates an empty patch')
assert.equal(typeof volatile.value.get, 'function', 'volatile schema resolves to a live section reference')
const resolved = volatile.value.get()
assert.equal(resolved.enabled, true, 'enabled defaults to true')
assert.equal(resolved.maxTokens, 2048, 'maxTokens defaults to 2048')

// The live config the fake Host hands to apply; tests mutate it to exercise
// hot edits and the master switch.
const config = { ...resolved, visionProvider: 'vp', visionModel: 'vm' }

const tools = new Map()
const promptContexts = new Map()
const listeners = new Map()
const visionRequests = []
let visionAnswer = 'ANSWER'
let visionFailure
let resolveCalls = 0

const session = {
  deriveMessages: () => [{
    content: [{ type: 'image', attachment: { attachmentId: 'ref-1', name: 'chart.png', width: 8, height: 8, mediaType: 'image/png' } }],
  }],
}

const core = {
  tools: {
    register(definition) {
      tools.set(definition.name, definition)
      return () => tools.delete(definition.name)
    },
  },
  systemPrompt: {
    context(entry) {
      promptContexts.set(entry.name, entry)
      return () => promptContexts.delete(entry.name)
    },
  },
  attachments: {
    async saveImages(inputs) {
      return inputs.map(input => ({ attachmentId: `saved-${input.name}`, name: input.name, width: 1, height: 1, mediaType: input.mediaType }))
    },
    imageHostPath: ref => `/host/${ref.name}`,
  },
  sessions: { get: () => session },
  llm: {
    // Text-only metadata: the admission patch must report image on top of it,
    // while the plugin's own backoff keeps seeing the original list.
    async resolveModelInfo(provider) {
      resolveCalls++
      return { provider, inputModalities: provider === 'vpp' ? ['image'] : ['text'] }
    },
    stream(options) {
      visionRequests.push(options)
      return (async function* () {
        yield { type: 'text-delta', text: visionAnswer }
        yield { type: 'finish', reason: visionFailure ? { kind: 'error', failure: { message: visionFailure } } : { kind: 'stop' } }
      })()
    },
  },
}

const on = (event, listener) => {
  if (!listeners.has(event)) listeners.set(event, new Set())
  listeners.get(event).add(listener)
  return () => listeners.get(event).delete(listener)
}
let dispose
const ctx = {
  // cordis handles the plugin fiber's disposal itself; the fake captures the
  // callback's cleanup the same way a real host would.
  inject(_services, cb) { dispose = cb(core) },
  on,
  effect() {},
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

apply(ctx, { get: () => config })

// Registration
assert.deepEqual([...tools.keys()].sort(), ['list_conversation_images', 'understand_image'], 'both tools register')
assert.ok(promptContexts.has('vision:image-guidance'), 'guidance context registers')

// Admission relax: image capability reported on top of text-only metadata.
const originalResolve = core.llm.resolveModelInfo
assert.notEqual(originalResolve, undefined)
const relaxedInfo = await core.llm.resolveModelInfo('vp', 'vm')
assert.deepEqual(relaxedInfo.inputModalities, ['text', 'image'], 'admission gate sees image added')

// Guidance: text-only route gets the body; the plugin's own lookup still saw
// the real (text-only) metadata.
const guidanceText = promptContexts.get('vision:image-guidance').text
const firstVerdict = guidanceText({ agent: { options: { provider: 'p', model: 'm' } } })
assert.match(firstVerdict, /understand_image/, 'text-only agent gets guidance')
await tick()
assert.equal(resolveCalls >= 1, true, 'backoff lookup resolved the route')
assert.match(guidanceText({ agent: { options: { provider: 'p', model: 'm' } } }), /understand_image/, 'cached text-only verdict keeps guidance')

// Guidance backs off once the resolved route declares image input. The first
// call for the route fires the async resolve and rides the conservative
// text-only default; the next round sees the cached verdict.
assert.match(guidanceText({ agent: { options: { provider: 'vpp', model: 'vision-model' } } }), /understand_image/, 'unresolved route rides the conservative default')
await tick()
assert.equal(guidanceText({ agent: { options: { provider: 'vpp', model: 'vision-model' } } }), '', 'vision-capable route gets no guidance once resolved')

// Live config: flipping the master switch (or clearing the target) changes
// decisions on the next read without re-apply.
config.enabled = false
assert.equal(guidanceText({ agent: { options: { provider: 'p', model: 'm' } } }), '', 'disabled config suppresses guidance')
config.enabled = true
config.guidanceInjection = false
assert.equal(guidanceText({ agent: { options: { provider: 'p', model: 'm' } } }), '', 'guidanceInjection=false suppresses guidance')
config.guidanceInjection = true
config.overrides = [{ model: 'm', modality: 'image' }]
assert.equal(guidanceText({ agent: { options: { provider: 'p', model: 'm' } } }), '', 'user override suppresses guidance')
config.overrides = []

// Prewarm listeners.
for (const listener of listeners.get('agent/created')) listener({ agent: { options: { provider: 'pre', model: 'warm' } } })
for (const listener of listeners.get('session/event')) listener(session, { type: 'model/selection', data: { provider: 'sel', model: 'ect' } })
await tick()
assert.ok(resolveCalls >= 3, 'prewarm resolved agent + selection routes')

// Reconcile: post-waterfall override for the actually selected route.
const assembled = await (async () => {
  let result
  const next = async () => ({
    variables: { provider: 'vpp', model: 'vision-model' },
    contexts: [{ name: 'vision:image-guidance', text: 'stale guidance' }],
  })
  for (const listener of listeners.get('system-prompt/assemble')) result = await listener({}, { agent: { options: { provider: 'p', model: 'm' } } }, next)
  return result
})()
assert.equal(assembled.contexts[0].text, '', 'reconcile drops guidance for the selected vision route')

const exec = { signal: new AbortController().signal, agent: { id: 'agent-1' } }
const run = async (args) => tools.get('understand_image').execute(args, exec)

// Argument validation.
await assert.rejects(run({ prompt: '  ' }), /context-derived `prompt`/, 'empty prompt rejects')
config.enabled = false
await assert.rejects(run({ prompt: 'q' }), /disabled/, 'master switch disables the tool')
config.enabled = true
config.visionProvider = ''
await assert.rejects(run({ prompt: 'q' }), /no vision model configured/, 'missing target rejects')
config.visionProvider = 'vp'

// Happy path 1: most recent conversation image (no path).
visionAnswer = 'CHART-ANSWER'
assert.equal(await run({ prompt: 'What does the chart show?' }), 'CHART-ANSWER', 'vision answer returned')
assert.equal(visionRequests.at(-1).provider, 'vp')
assert.equal(visionRequests.at(-1).model, 'vm')
const lastMessages = visionRequests.at(-1).messages
assert.equal(lastMessages.length, 1, 'one vision request message')
assert.deepEqual(lastMessages[0].content.map(block => block.type), ['text', 'image'], 'question + image block')
assert.equal(lastMessages[0].content[1].attachment.attachmentId, 'ref-1', 'durable conversation ref reused')

// Happy path 2: explicit file path goes through saveImages.
const dir = mkdtempSync(join(tmpdir(), 'dvt-smoke-'))
const imagePath = join(dir, 'photo.png')
writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
try {
  visionAnswer = 'FILE-ANSWER'
  assert.equal(await run({ path: imagePath, prompt: 'q' }), 'FILE-ANSWER', 'file-path answer returned')
  const imageBlock = visionRequests.at(-1).messages[0].content[1]
  assert.equal(imageBlock.attachment.attachmentId, 'saved-photo.png', 'file saved through attachments')
} finally {
  rmSync(dir, { recursive: true, force: true })
}

// Stream failure surfaces as a tool error.
visionFailure = 'boom'
await assert.rejects(run({ prompt: 'q' }), /boom/, 'stream failure becomes tool error')
visionFailure = undefined

// list_conversation_images: numbering, name, and host path.
const listText = await tools.get('list_conversation_images').execute({}, exec)
assert.match(listText, /^1\. chart\.png \(8x8, image\/png\) — \/host\/chart\.png$/, 'listing renders one line')

// Unwind: everything unregisters, the admission gate is restored.
dispose()
assert.equal(tools.size, 0, 'tools unregistered')
assert.equal(promptContexts.size, 0, 'guidance context unregistered')
assert.ok([...listeners.values()].every(set => set.size === 0), 'listeners disposed')
core.llm.resolveModelInfo('vp', 'vm').then(info => {
  assert.deepEqual(info.inputModalities, ['text'], 'stock admission gate restored')
  console.log('smoke ok')
}, error => {
  console.error(error)
  process.exit(1)
})
