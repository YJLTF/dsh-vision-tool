/**
 * Browser half of the vision-proxy plugin.
 *
 * Renders a settings card (keyed by the `vision` namespace) inside the dsh web
 * Settings → Plugins page. It lets the user pick the small multimodal
 * (provider, model) from the models dsh already has configured — no second
 * model registry — and mark which configured models declare multimodal input,
 * which drives the plugin's back-off.
 *
 * BUILD NOTE: this client bundle must be produced by the DeepSeek Harness
 * monorepo build (`tsdown.client` preset + client module-loader), which is not
 * reproducible as a standalone package. The Host half of this plugin builds
 * standalone; the card below is the integration scaffold to finalize inside
 * the monorepo against the concrete `ctx.settingsScope` / plugin-slot typings.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Keyed-slot declaration; cross-plugin collaboration stays type-only so the
// client bundle keeps its purity gate (see the adding-a-settings-card cookbook).
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { VISION_NS } from '../config.js'
import { VisionModelCard } from './vision-model-card.js'

export interface VisionClientConfig {
  enabled: boolean
  visionProvider?: string
  visionModel?: string
  visionSystemPrompt?: string
  maxTokens?: number
  guidanceInjection?: boolean
  overrides?: { model: string; modality: 'text' | 'image' }[]
}

export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

export function apply(ctx: ClientContext): void {
  const scope = ctx.settingsScope.bind({ namespace: VISION_NS })
  ctx.slots.inject('settings.plugin.item', () =>
    ctx.slots.register(
      {
        name: 'settings.plugin.item',
        key: VISION_NS,
        inject: () => ({ scope }),
      },
      VisionModelCard,
    ),
  )
}