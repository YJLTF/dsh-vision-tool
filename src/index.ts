import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'
import type { ModelModality } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-session'
import { Config, PLUGIN_NAME, VISION_DEFAULT_PROMPT, VISION_NS, type Config as ConfigType } from './config.js'
import { isVision } from './capability.js'
import { registerUnderstandImageTool } from './tool-understand-image.js'

/**
 * Vision capability proxy for the DeepSeek Harness.
 *
 * Goal: a text-only main model can still "see" images by delegating to a small
 * multimodal model through the `understand_image` tool; when the active model
 * declares image capability, the plugin backs off and leaves the native image
 * path untouched.
 *
 * Backoff note: the harness already drops image bytes for routes whose adapter
 * declares `inputModalities` without `image` (approved for text-only models).
 * This plugin therefore never has to rewrite messages; it only (a) provides the
 * compensating tool, (b) emits advisory guidance for text-only agents and
 * suppresses it for models the user has marked multimodal or that the adapter
 * reports as image-capable, and (c) relaxes the session prompt-admission gate
 * (`relaxImageAdmission`) so image-bearing prompts reach text-only agents
 * instead of being rejected before the model ever sees them.
 */
export const name = PLUGIN_NAME
export const inject = ['settings', 'llm', 'attachments', 'tools', 'systemPrompt', 'sessions']

interface ResolveModelInfo {
  (provider: string, model: string, signal?: AbortSignal): Promise<{ inputModalities?: readonly ModelModality[] }>
}

export function apply(ctx: Context, initial: ConfigType) {
  // Read-through state so edits made in the web card apply to later requests.
  // `setSource` hands us the current config *reader*, not a snapshot.
  let currentSource: () => ConfigType = () => initial
  const readConfig = () => currentSource()
  const visionTarget = () => {
    const config = readConfig()
    return {
      provider: config.visionProvider || undefined,
      model: config.visionModel || undefined,
      systemPrompt: config.visionSystemPrompt ?? VISION_DEFAULT_PROMPT,
      maxTokens: config.maxTokens ?? 2048,
    }
  }

  ctx.inject(['settings'], (settingsCtx) => {
    return settingsCtx.settings.installSection(ctx, VISION_NS, Config, initial, {
      setSource: (next) => {
        currentSource = next
      },
      onChange: () => {
        // Read-through needs no invalidation: every consumer re-reads
        // `readConfig()` per request, so there is nothing to flush here.
      },
    })
  })

  ctx.inject(['llm', 'attachments', 'tools', 'systemPrompt', 'sessions'], (core) => {
    // The unpatched resolve, captured before the admission gate is relaxed —
    // the plugin's own backoff decisions must see real adapter metadata.
    const resolveModelInfo = relaxImageAdmission(core.llm)
    // Adapter-declared input modalities, resolved once per provider/model route
    // and cached for the synchronous guidance callback (which cannot await).
    // A route's first assembly falls back to the conservative text-only default
    // while the resolve is in flight; later rounds see the cached verdict.
    const modalityCache = new Map<string, ModelModality[] | undefined>()
    const modalitiesOf = (provider: string, model: string): ModelModality[] | undefined => {
      const key = `${provider}\u0000${model}`
      if (!modalityCache.has(key)) {
        modalityCache.set(key, undefined)
        void resolveModelInfo(provider, model)
          .then(info => modalityCache.set(key, info.inputModalities === undefined ? undefined : [...info.inputModalities]))
          .catch(() => {})
      }
      return modalityCache.get(key)
    }

    const unregisterTool = registerUnderstandImageTool(core, visionTarget)
    const unregisterGuidance = core.systemPrompt.context({
      name: `${VISION_NS}:image-guidance`,
      order: 2000,
      text: (assembly) => guidanceFor(assembly, readConfig(), modalitiesOf),
    })
    return () => {
      unregisterTool()
      unregisterGuidance()
      restoreAdmission(core.llm)
    }
  })
}

/**
 * Model-visible guidance emitted only for text-only agents. Vision-capable
 * agents get nothing, so the plugin never interferes with native multimodal use.
 *
 * Suppression precedence: the user's `overrides` mark wins; then the adapter's
 * declared `inputModalities` via `lookup` (cached; unknown conservatively keeps
 * the guidance). Routes with no declared metadata default to text-only,
 * matching the harness engine's own projection behavior.
 */
function guidanceFor(
  assembly: AssembleContext,
  config: ConfigType,
  lookup: (provider: string, model: string) => ModelModality[] | undefined,
): string {
  if (config.enabled === false || config.guidanceInjection === false) return ''
  if (!config.visionProvider || !config.visionModel) return ''
  const agent: Agent | undefined = assembly.agent
  if (agent === undefined) return ''
  const activeModel = agent.options.model
  if (activeModel === undefined) return ''
  // Back off when the user explicitly marked the agent's active model
  // multimodal, or when the adapter declares image input for the route.
  const markedVision = config.overrides?.some(
    entry => entry.model === activeModel && entry.modality === 'image',
  )
  if (markedVision) return ''
  const provider = agent.options.provider
  if (provider !== undefined && isVision(lookup(provider, activeModel))) return ''
  return [
    'Some conversation messages may contain image placeholders like '
    + '"[image omitted because this model accepts text only; attachment sha256:…]" '
    + 'or reference attached images that you cannot see directly (your model is '
    + 'text-only). Those images ARE still available to you: call `understand_image` '
    + '— omitting `path` inspects the most recent image in this conversation, and '
    + 'you can call `list_conversation_images` first when several images are '
    + 'present. The `prompt` is the specific question or task you need answered '
    + 'for your current work, composed from the ongoing conversation — NOT a '
    + 'generic "describe the image". Fold any relevant conversational context into '
    + 'the prompt so the vision model answers precisely. Never claim to have seen '
    + 'an image unless you actually ran `understand_image`.',
  ].join('')
}

interface RelaxedResolveModelInfo extends ResolveModelInfo {
  __visionOriginal?: ResolveModelInfo
}

/**
 * Relax the session prompt-admission image gate on the shared LlmRuntime.
 *
 * The Host rejects a prompt that carries an image outright when the session's
 * selected model declares text-only input (`MODEL_DOES_NOT_SUPPORT_IMAGES`),
 * so a text-only main model can never receive the message — and never gets the
 * chance to call `understand_image`. Patching the service method that gate
 * calls to report image capability lets image-bearing prompts through, while
 * the request layer keeps projecting image bytes from the adapter's own
 * (unpatched) metadata: the model sees the standard text placeholder and can
 * call the tool. Native multimodal routes are untouched (the gate never fires
 * for them), and other consumers of the method degrade safely because the
 * request layer never relies on it.
 *
 * @returns the stock resolve, for callers that must see real metadata.
 */
function relaxImageAdmission(llm: { resolveModelInfo: ResolveModelInfo }): ResolveModelInfo {
  const original = llm.resolveModelInfo
  if (typeof original !== 'function' || (original as RelaxedResolveModelInfo).__visionOriginal !== undefined) return original
  const relaxed = ((provider: string, model: string, signal?: AbortSignal) =>
    Promise.resolve(original.call(llm, provider, model, signal)).then(info => {
      if (info.inputModalities !== undefined && !info.inputModalities.includes('image')) {
        return { ...info, inputModalities: [...info.inputModalities, 'image'] }
      }
      return info
    })) as RelaxedResolveModelInfo
  relaxed.__visionOriginal = original
  try {
    llm.resolveModelInfo = relaxed
  } catch {
    // A non-writable service facade keeps the stock gate; the plugin still
    // works for native multimodal models and for models the user marks
    // multimodal via overrides.
    return original
  }
  return original
}

/** Restore the stock admission gate on plugin teardown. */
function restoreAdmission(llm: { resolveModelInfo: ResolveModelInfo }): void {
  const current = llm.resolveModelInfo as RelaxedResolveModelInfo
  if (current?.__visionOriginal === undefined) return
  try {
    llm.resolveModelInfo = current.__visionOriginal
  } catch {
    // Non-writable facade: the relaxed gate stays until process exit, which is
    // harmless — it only ever relaxes the image gate this plugin owns.
  }
}
