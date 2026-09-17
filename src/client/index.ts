/**
 * Browser half of the dsh-vision-tool plugin.
 *
 * Renders a settings card (keyed by the `vision` namespace) inside the dsh web
 * Settings → Plugins page. It lets the user pick the small multimodal
 * (provider, model) from the models dsh already has configured — the card reads
 * the Host-generation model catalog through `remote.session.modelCatalog()`, the
 * same read the built-in model picker uses — and mark which configured models
 * declare multimodal input, which drives the plugin's back-off.
 *
 * BUILD: this bundle must ship as `lib/client.js` in the lazy-CJS
 * `window.__ModuleLoader__` wrapper the web plugin route serves; see
 * `scripts/build-client.mjs`, which reproduces the monorepo's
 * `tsdown.client` output shape standalone (externalized `@deepseek-ai/*` and
 * `react` resolved through the loader's `require`).
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Keyed-slot declaration; cross-plugin collaboration stays type-only so the
// client bundle keeps its purity gate (see the adding-a-settings-card cookbook).
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { VISION_NS } from '../meta.js'
import { VisionModelCard, type ModelChoice } from './vision-model-card.js'

/** Card face injected beside the scope: the configured-model choices. */
export interface VisionCardFace {
  scope: {
    getSnapshot(): {
      value: Record<string, unknown> | undefined
      /** Whether the Host document accepts writes; memory mode never does. */
      writable: boolean
    }
    subscribe(listener: () => void): () => void
    set(field: string, value: unknown): Promise<void>
    unset(field: string): Promise<void>
    /** One atomic namespace mutation over path-addressed edits. */
    mutate(ops: readonly ({ op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] })[]): Promise<void>
  }
  /**
   * Snapshot of the catalog read so far, copied per call. The inject face is
   * consulted at render time, so a card mounted before the catalog settled
   * picks the list up on its manual refresh instead of pinning an empty array.
   */
  listModels(): ModelChoice[]
  /** Last catalog-read failure, when the list is empty because of one. */
  lastError(): string | undefined
  refresh(): Promise<void>
}

export const inject = ['slots', 'settingsScope', 'remote', 'remote.session']

export function apply(ctx: ClientContext): void {
  const scope = ctx.settingsScope.bind({ namespace: VISION_NS })
  // The Host-generation model catalog — dsh's single source of configured
  // models — read once at activation and re-readable from the card. A failed
  // or absent catalog degrades the card to manual entry, never to no card.
  let available: ModelChoice[] = []
  let lastError: string | undefined
  const refresh = async (): Promise<void> => {
    try {
      const response = await ctx.remote.session.modelCatalog()
      if (response.ok) {
        available = response.value.groups.flatMap(group =>
          group.models.map(model => ({
            provider: group.id,
            model: model.id,
            name: model.name,
          })),
        )
        lastError = undefined
      } else {
        lastError = `${response.error.code}: ${response.error.message}`
      }
    } catch (error) {
      // Catalog unreachable (e.g. memory mode); keep whatever we had.
      lastError = error instanceof Error ? error.message : String(error)
    }
  }
  void refresh()
  ctx.slots.inject('settings.plugin.item', () =>
    ctx.slots.register(
      {
        name: 'settings.plugin.item',
        key: VISION_NS,
        inject: () => ({ scope, listModels: () => available.slice(), lastError: () => lastError, refresh }),
      },
      VisionModelCard,
    ),
  )
}
