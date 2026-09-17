import z from '@deepseek-ai/schemastery'
import { VISION_DEFAULT_PROMPT } from './meta.js'

export { PLUGIN_NAME, VISION_DEFAULT_PROMPT, VISION_NS } from './meta.js'

export interface ModalityOverride {
  /** Exact model id the declaration applies to. */
  model: string
  /** Whether the model can accept image input. */
  modality: 'text' | 'image'
}

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
  overrides?: ModalityOverride[]
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  visionProvider: z.string().default(''),
  visionModel: z.string().default(''),
  visionSystemPrompt: z.string().default(VISION_DEFAULT_PROMPT),
  maxTokens: z.natural().min(256).max(8192).default(2048),
  guidanceInjection: z.boolean().default(true),
  overrides: z.array(z.object({
    model: z.string(),
    modality: z.union([z.const('text'), z.const('image')]),
  })).default([]),
})