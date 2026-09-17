import type { Context } from '@deepseek-ai/cordis'
import type { ModelModality } from '@deepseek-ai/dsh-llm'
import type { Config } from './config.js'

/**
 * Resolve which input modalities one exact provider/model route declares.
 *
 * Priority (highest first):
 * 1. the user's explicit override in `config.overrides` (a model the user
 *    marked as multimodal must back off, regardless of provider metadata);
 * 2. the adapter's declared `inputModalities` via `ctx.llm.resolveModelInfo`;
 * 3. `undefined` when unknown.
 *
 * A returned list that includes `'image'` means the route is vision-capable.
 * `undefined` means "unknown"; callers fall back to the platform default
 * (the engine treats an undocumented route as text and projects images away).
 */
export async function resolveModalities(
  ctx: Context,
  provider: string | undefined,
  model: string | undefined,
  overrides: Config['overrides'],
): Promise<ModelModality[] | undefined> {
  if (provider === undefined || model === undefined) return undefined
  const override = overrides?.find(entry => entry.model === model)
  if (override !== undefined) return [override.modality]
  try {
    const info = await ctx.llm.resolveModelInfo(provider, model)
    return info.inputModalities === undefined ? undefined : [...info.inputModalities]
  } catch {
    return undefined
  }
}

/** Whether a resolved modality list includes image support. */
export function isVision(modalities: readonly ModelModality[] | undefined): boolean {
  return modalities?.includes('image') === true
}

/** Whether a resolved modality list is unambiguously text-only. */
export function isTextOnly(modalities: readonly ModelModality[] | undefined): boolean {
  return modalities !== undefined && !modalities.includes('image')
}