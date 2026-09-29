import z from '@deepseek-ai/schemastery'
import { VISION_DEFAULT_PROMPT } from './meta.js'

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

const lang = {
  'zh-CN': {
    enabled: '总开关:关闭后识图指导不注入,两个识图工具都会拒绝执行',
    visionProvider: '识图模型的提供方路由(如 zai-coding-cn)',
    visionModel: '识图模型的精确模型 id(须在 dsh 模型配置里声明图片输入)',
    visionSystemPrompt: '视觉模型每次识图调用遵循的系统提示词',
    maxTokens: '单次识图调用的最大输出 token 数(256–8192)',
    guidanceInjection: '为纯文本模型注入识图指导(多模态模型自动退避)',
    overrides: '多模态声明覆盖:按模型显式声明模态,优先级高于适配器元数据(退避依据)',
    model: '模型 id',
    modality: '声明的输入模态',
  },
} as const

const labeled = <T,>(node: z<T>, key: keyof typeof lang['zh-CN']): z<T> =>
  node.i18n({
    'zh-CN': { description: lang['zh-CN'][key] },
    'en-US': { description: key },
  })

// Root-volatile marker: `.extra('volatile', true)` is the official `.volatile()`
// marking (that method delegates to exactly this call), spelled out because its
// typed wrapper changes the schema's call-signature mode away from `z<Config>`.
export const Config: z<Config> = z.object({
  enabled: labeled(z.boolean().default(true), 'enabled'),
  visionProvider: labeled(z.string().default(''), 'visionProvider'),
  visionModel: labeled(z.string().default(''), 'visionModel'),
  visionSystemPrompt: labeled(z.string().default(VISION_DEFAULT_PROMPT), 'visionSystemPrompt'),
  maxTokens: labeled(z.natural().min(256).max(8192).default(2048), 'maxTokens'),
  guidanceInjection: labeled(z.boolean().default(true), 'guidanceInjection'),
  overrides: labeled(z.array(z.object({
    model: labeled(z.string(), 'model'),
    modality: labeled(z.union([z.const('text'), z.const('image')]), 'modality'),
  })).default([]), 'overrides'),
}).extra('volatile', true)
  .i18n({
    'zh-CN': { description: '识图代理:为纯文本主模型补上图片理解能力(详见 README)' },
  })