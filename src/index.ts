import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'
import type { ModelModality } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'
import { Config, PLUGIN_NAME, VISION_DEFAULT_PROMPT, VISION_NS, type Config as ConfigType } from './config.js'
import { isVision, resolveModalities } from './capability.js'
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
 * compensating tool and (b) emits advisory guidance for text-only agents and
 * suppresses it for models the user has marked multimodal or that the adapter
 * reports as image-capable.
 */
export const name = PLUGIN_NAME
export const inject = ['settings', 'llm', 'attachments', 'tools', 'systemPrompt']

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

  // Adapter-declared input modalities, resolved once per provider/model route
  // and cached for the synchronous guidance callback (which cannot await).
  // A route's first assembly falls back to the conservative text-only default
  // while the resolve is in flight; later rounds see the cached verdict.
  const adapterModalities = new Map<string, ModelModality[] | undefined>()
  const modalitiesOf = (provider: string, model: string): ModelModality[] | undefined => {
    const key = `${provider}\u0000${model}`
    if (!adapterModalities.has(key)) {
      adapterModalities.set(key, undefined)
      // Empty overrides: the cache holds pure adapter metadata — the user's
      // `overrides` mark is checked separately with higher precedence.
      void resolveModalities(ctx, provider, model, []).then(modalities =>
        adapterModalities.set(key, modalities))
    }
    return adapterModalities.get(key)
  }

  ctx.inject(['llm', 'attachments', 'tools', 'systemPrompt'], (core) => {
    const unregisterTool = registerUnderstandImageTool(core, visionTarget)
    const unregisterGuidance = core.systemPrompt.context({
      name: `${VISION_NS}:image-guidance`,
      order: 2000,
      text: (assembly) => guidanceFor(assembly, readConfig(), modalitiesOf),
    })
    return () => {
      unregisterTool()
      unregisterGuidance()
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
    'Some conversation messages may reference attached images that you cannot ',
    'see directly (your model is text-only). To inspect one, call ',
    '`understand_image` with the image file path and a `prompt`: the prompt is ',
    'the specific question or task you need answered for your current work, ',
    'composed from the ongoing conversation — NOT a generic "describe the image". ',
    'Fold any relevant conversational context into the prompt so the vision model ',
    'answers precisely. Never claim to have seen an image unless you actually ran ',
    '`understand_image`.',
  ].join('')
}
