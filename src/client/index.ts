/**
 * Browser half of the dsh-vision-tool plugin.
 *
 * Renders the vision configuration card on the bundle's own page inside the
 * dsh Plugin Manager (web 顶部「插件」按钮 → 插件管理页 → 已安装 → vision-tool)。
 * Since dsh 0.1.6-alpha.2 the Settings page no longer hosts plugin cards; the
 * plugin manager asks bundles for their configuration through the
 * `plugins.bundle.config` keyed slot, keyed by the bundle's package name and
 * rendered with the owner face `{ view }` (`'page'` on the bundle's page,
 * `'summary'` reserved for one-liners).
 *
 * Since dsh 0.1.7-alpha.1 the settings namespace model is gone: the plugin's
 * Config fields declared `.volatile()` are exposed per profile entry id, and
 * the browser reaches them through the `configForms` service —
 * `configForms.get(entryId)` returns the entry's shared form (snapshot +
 * serialized writes), with the entry id equal to this bundle's package name
 * (the id its `cordis.patch.yml` inserts). The card still reads the
 * Host-generation model catalog through `remote.session.modelCatalog()`, the
 * same read the built-in model picker uses.
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
import { PLUGIN_NAME } from '../meta.js'
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
    set(field: string, value: unknown): Promise<boolean>
    unset(field: string): Promise<boolean>
    /** One atomic namespace mutation over path-addressed edits. */
    mutate(ops: readonly ({ op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] })[]): Promise<boolean>
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

export const inject = ['slots', 'configForms', 'remote', 'remote.session']

export function apply(ctx: ClientContext): void {
  // The entry's shared configuration form — the volatile Config fields the web
  // card edits, identified by this bundle's profile entry id (the package
  // name). Owned by the settings provider; reads derive from its shared
  // describe mirror, writes serialize through `remote.settings`.
  const scope = ctx.configForms.get(PLUGIN_NAME)
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
