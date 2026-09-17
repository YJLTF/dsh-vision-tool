import type { ModelModality } from '@deepseek-ai/dsh-llm'

/**
 * Whether a resolved modality list includes image support, i.e. the route is
 * vision-capable. `undefined` (unknown metadata) conservatively counts as
 * text-only, matching the engine's own projection default.
 */
export function isVision(modalities: readonly ModelModality[] | undefined): boolean {
  return modalities?.includes('image') === true
}
