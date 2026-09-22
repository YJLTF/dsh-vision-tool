import z from '@deepseek-ai/schemastery'
import type { Volatile } from '@deepseek-ai/cosmokit'
import { VISION_DEFAULT_PROMPT } from './meta.js'

export { PLUGIN_NAME, VISION_DEFAULT_PROMPT } from './meta.js'

export interface ModalityOverride {
  /** Exact model id the declaration applies to. */
  model: string
  /** Whether the model can accept image input. */
  modality: 'text' | 'image'
}

/**
 * Plain config values, as the web card edits them and as business logic reads
 * them. Since dsh 0.1.7 every field the card edits is declared `.volatile()`:
 * the Settings form only exposes volatile fields, and each arrives in the
 * resolved config as a live reference the Loader updates in place.
 */
export interface Config {
  /** Master switch for the whole vision proxy. */
  enabled?: boolean
  /** Provider route of the small multimodal model (one of dsh's configured models). */
  visionProvider?: string
  /** Exact model id of the small multimodal model. */
  visionModel?: string
  /** System prompt the vision model follows for every call. */
  visionSystemPrompt?: string
  /** Max output tokens for a vision call. */
  maxTokens?: number
  /** Emit model-visible guidance about attached images for text-only agents. */
  guidanceInjection?: boolean
  /** User-declared model modalities; consulted ahead of adapter metadata. */
  overrides?: readonly ModalityOverride[]
}

/**
 * The resolved config the Loader hands to `apply`: every field the card edits
 * is a `.volatile()` reference — hold it and read through `.get()` per use;
 * card writes reach later requests without a plugin restart.
 */
export interface ResolvedConfig {
  enabled: Volatile<boolean>
  visionProvider: Volatile<string>
  visionModel: Volatile<string>
  visionSystemPrompt: Volatile<string>
  maxTokens: Volatile<number>
  guidanceInjection: Volatile<boolean>
  overrides: Volatile<readonly ModalityOverride[]>
}

export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  visionProvider: z.string().default('').volatile(),
  visionModel: z.string().default('').volatile(),
  visionSystemPrompt: z.string().default(VISION_DEFAULT_PROMPT).volatile(),
  maxTokens: z.natural().min(256).max(8192).default(2048).volatile(),
  guidanceInjection: z.boolean().default(true).volatile(),
  overrides: z.array(z.object({
    model: z.string(),
    modality: z.union([z.const('text'), z.const('image')]),
  })).default([]).volatile(),
})
