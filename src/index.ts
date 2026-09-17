import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-settings'
import { Config, PLUGIN_NAME, VISION_DEFAULT_PROMPT, VISION_NS, type Config as ConfigType } from './config.js'
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
        // Hot: `readConfig()` is read through on the next request.
        void visionTarget()
      },
    })
  })

  ctx.inject(['llm', 'attachments', 'tools', 'systemPrompt'], (core) => {
    const unregisterTool = registerUnderstandImageTool(core, visionTarget)
    const unregisterGuidance = core.systemPrompt.context({
      name: `${VISION_NS}:image-guidance`,
      order: 2000,
      text: (assembly) => guidanceFor(assembly, readConfig()),
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
 */
function guidanceFor(assembly: AssembleContext, config: ConfigType): string {
  if (config.enabled === false || config.guidanceInjection === false) return ''
  if (!config.visionProvider || !config.visionModel) return ''
  const agent: Agent | undefined = assembly.agent
  if (agent === undefined) return ''
  // Back off when the user explicitly marked the agent's active model
  // multimodal. Undeclared models default to the text-only path, matching the
  // harness engine's own `inputModalities` projection behavior.
  const activeModel = agent.options.model
  if (activeModel === undefined) return ''
  const markedVision = config.overrides?.some(
    entry => entry.model === activeModel && entry.modality === 'image',
  )
  if (markedVision) return ''
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