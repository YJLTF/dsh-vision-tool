/**
 * Browser half of the dsh-vision-tool plugin.
 *
 * Renders the vision configuration card on the bundle's own page inside the
 * dsh Plugin Manager (web 顶部「插件」按钮 → 插件管理页 → 已安装 → vision-tool)。
 * Since dsh 0.1.6-alpha.2 the Settings page no longer hosts plugin cards; the
 * plugin manager asks bundles for their configuration through the
 * `plugins.bundle.config` keyed slot, keyed by the bundle's package name and
 * rendered with the owner face `{ view }` (`'page'` on the bundle's page,
 * `'summary'` reserved for one-liners). The card still reads the
 * Host-generation model catalog through `remote.session.modelCatalog()`, the
 * same read the built-in model picker uses, and edits the `vision` settings
 * namespace through the client settings scope.
 *
 * BUILD: this bundle must ship as `lib/client.js` in the lazy-CJS
 * `window.__ModuleLoader__` wrapper the web plugin route serves; see
 * `scripts/build-client.mjs`, which reproduces the monorepo's
 * `tsdown.client` output shape standalone (externalized `@deepseek-ai/*` and
 * `react` resolved through the loader's `require`).
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Keyed-slot declaration; cross-plugin collaboration stays type-only so the
// client bundle keeps its purity gate (slot contract owned by the plugin
// manager package, never imported at runtime).
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { PLUGIN_NAME, VISION_NS } from '../meta.js'
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
  ctx.slots.inject('plugins.bundle.config', () =>
    ctx.slots.register(
      {
        name: 'plugins.bundle.config',
        // The plugin manager keys bundle configuration by the bundle's exact
        // package name (entryKey: pkg.name) — the card only shows on this
        // bundle's page.
        key: PLUGIN_NAME,
        inject: () => ({ scope, listModels: () => available.slice(), lastError: () => lastError, refresh }),
      },
      VisionModelCard,
    ),
  )
}
