/**
 * Browser half of the dsh-vision-tool plugin.
 *
 * Renders the vision configuration card on the bundle's own page inside the
 * dsh Plugin Manager (web 顶部「插件」按钮 → 插件管理页 → 已安装 → vision-tool),
 * following the official "adding a settings card" recipe: the plugin manager
 * asks bundles for their configuration through the `plugins.bundle.config`
 * keyed slot — keyed by the bundle's exact package name, rendered on the
 * bundle's page with the owner face `{ view: 'page' }`. Unlike a row page, a
 * bundle page passes no `form` prop (one bundle may hold several entries), so
 * the card reaches its entry's shared form itself via `ctx.configForms.get`.
 *
 * The registration lives inside `ctx.configForms.whileServed([ns], …)` — the
 * official pattern — so the card exists exactly while the Host serves this
 * entry's settings namespace, and leaves no trace on deployments where it
 * does not.
 *
 * Config values and writes ride the 0.2.0 settings stack: the Host turns the
 * plugin's own Config schema into the profile entry's form (`ns` = the patch
 * insert id, our package name), the shared browser mirror reads it, and the
 * card edits the section through the shared form — the same document the
 * Settings stack derives from. Edits are staged; 保存 writes them as one
 * atomic revision-fenced mutation, and the Host half's volatile live read
 * applies them to later requests without a reload. The card still reads the
 * Host-generation model catalog through `remote.session.modelCatalog()`, the
 * same read the built-in model picker uses.
 *
 * BUILD: this bundle must ship as `lib/client.js` in the lazy-CJS
 * `window.__ModuleLoader__` wrapper the web plugin route serves; see
 * `scripts/build-client.mjs`, which reproduces the monorepo's
 * `tsdown.client` output shape standalone (externalized `@deepseek-ai/*` and
 * `react` resolved through the loader's `require`).
 */
import type { ComponentType } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Keyed-slot declaration; cross-plugin collaboration stays type-only so the
// client bundle keeps its purity gate (slot contract owned by the plugin
// manager package, never imported at runtime).
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
// The settings domain's shared forms service (`ctx.configForms`), provided by
// the composed ui-settings plugin. Type-only: the runtime service arrives
// through cordis injection.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { PLUGIN_NAME } from '../meta.js'
import { VisionModelCard, type ModelChoice } from './vision-model-card.js'

// No shipped types package declares the slot registry on the client Context —
// declare the slice this bundle uses, matching the shape every first-party
// client plugin calls (`inject` returns the contribution's disposer; the
// settings domain's `whileServed` hands that disposer back to its watcher).
declare module '@deepseek-ai/cordis' {
  interface Context {
    slots: {
      /** Contribute to a slot while this plugin stays loaded; returns the disposer. */
      inject(name: string, factory: () => unknown): () => void
      /**
       * Register one entry: `name` selects the slot contract, `key` is the
       * keyed-slot identity (the bundle's package name for
       * `plugins.bundle.config`), `inject` supplies the component's face.
       */
      register(
        entry: { name: string; id?: string; key?: string; locale?: string; inject?: () => object },
        component: ComponentType<any>,
      ): unknown
    }
  }
}

/** Card face injected beside the scope: the configured-model choices. */
export interface VisionCardFace {
  /**
   * The entry's shared configuration form (values, revision, writes). Derived
   * from the same Host describe the Settings stack renders from.
   */
  scope: {
    /**
     * Stable projected snapshot — React's `useSyncExternalStore` requires the
     * same reference until the underlying store changes; the controller's
     * snapshot is itself stable, so this projection recomputes only on it.
     */
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
  // The Host-generation model catalog — dsh's single source of configured
  // models — read once at activation and re-readable from the card. A failed
  // or absent catalog degrades the card to manual entry, never to no card.
  let available: ModelChoice[] = []
  let lastError: string | undefined
  const refresh = async (): Promise<void> => {
    // The api-remotes type augmentation resolves through the carrier's
    // generated modules, which are not in a dynamic bundle's dep tree — the
    // response degrades to `any` at the type level, so the catalog shape is
    // annotated here against the wire schema.
    const response = await ctx.remote.session.modelCatalog() as {
      ok: boolean
      value?: { groups: readonly { id: string; models: readonly { id: string; name?: string }[] }[] }
      error?: { code: string; message: string }
    }
    if (response.ok) {
      available = (response.value?.groups ?? []).flatMap(group =>
        group.models.map(model => ({
          provider: group.id,
          model: model.id,
          name: model.name,
        })),
      )
      lastError = undefined
    } else if (response.error !== undefined) {
      lastError = `${response.error.code}: ${response.error.message}`
    }
  }
  void refresh()

  // The entry's shared configuration form. The shipped `cordis.patch.yml`
  // inserts the plugin as `id: dsh-vision-tool`, which is exactly the settings
  // namespace (`ns`) the Host serves — the form stays 'loading' until the
  // describe mirror settles, then carries values, writability, and the write
  // queue the card edits through.
  const form = ctx.configForms.get<Record<string, unknown>>(PLUGIN_NAME)
  // Stable projection of the form snapshot: `form.getSnapshot()` is stable
  // until the next change, and the projection follows it one-to-one, so the
  // card's `useSyncExternalStore` never observes a fresh-reference loop.
  let projectedFrom: unknown
  let projected = { value: undefined as Record<string, unknown> | undefined, writable: false }
  const scope: VisionCardFace['scope'] = {
    getSnapshot: () => {
      const snap = form.getSnapshot()
      if (snap !== projectedFrom) {
        projectedFrom = snap
        projected = { value: snap.value, writable: snap.writable }
      }
      return projected
    },
    subscribe: listener => form.subscribe(listener),
    set: (field, value) => form.set(field, value),
    unset: field => form.unset(field),
    // Card edits are JSON-shaped (strings, numbers, booleans, override rows);
    // the wire boundary narrows `unknown` to the path-op view.
    mutate: ops => form.mutate(ops as Parameters<typeof form.mutate>[0]),
  }

  // Official registration pattern: the card exists exactly while the Host
  // serves this entry's namespace. `whileServed` runs its callback once the
  // describe mirror exposes the ns and disposes it when the ns leaves; the
  // inner `slots.inject` keeps the keyed entry following the plugin manager's
  // own declaration lifetime.
  ctx.effect(
    () => ctx.configForms.whileServed([PLUGIN_NAME], () =>
      ctx.slots.inject('plugins.bundle.config', () =>
        ctx.slots.register(
          {
            name: 'plugins.bundle.config',
            // The plugin manager keys bundle configuration by the bundle's
            // exact package name (`entryKey: pkg.name`) — the card only shows
            // on this bundle's page.
            key: PLUGIN_NAME,
            inject: () => ({
              scope,
              listModels: () => available.slice(),
              lastError: () => lastError,
              refresh,
            }),
          },
          VisionModelCard,
        ),
      ),
    ),
    'dsh-vision-tool: bundle config card',
  )
}
