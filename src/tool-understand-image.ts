import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageMediaType, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock, StreamChunk } from '@deepseek-ai/dsh-llm'
import { PLUGIN_NAME } from './config.js'

const EXTENSION_TO_MEDIA: Record<string, ImageMediaType> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/**
 * Model-facing tool that answers image-understanding questions by dispatching a
 * one-shot multimodal request to the configured small vision model. It is the
 * compensation path for text-only main models: they never receive image bytes
 * (the harness projects images away for such routes), so they call this tool
 * to obtain a textual description through the vision model.
 */
export function registerUnderstandImageTool(ctx: Context, resolveVisionTarget: () => {
  provider?: string
  model?: string
  systemPrompt: string
  maxTokens: number
}) {
  return ctx.tools.register(defineTool({
    name: 'understand_image',
    description:
      'Inspect an image saved at a readable path against a specific question and '
      + 'return a focused textual answer. Use this when the conversation references '
      + 'an attached or available image that you cannot see directly. Pass the exact '
      + 'path and a `prompt` that is the question you actually need answered given '
      + 'your task and the ongoing conversation — NOT a generic "describe the '
      + 'image" instruction. Include the relevant conversational context inside '
      + '`prompt` so the vision model can answer precisely.',
    parameters: {
      path: {
        type: 'string',
        required: true,
        description: 'Readable absolute path of the image file to inspect.',
      },
      prompt: {
        type: 'string',
        required: true,
        description:
          'The context-derived question or task for the vision model, composed '
          + 'from your current task and the conversation. Must be specific, not a '
          + 'generic description request.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value: string): ContentBlock[] => [{ type: 'text', text: value }],
    },
    async execute(args: { path: string; prompt?: string }, exec) {
      const target = resolveVisionTarget()
      if (target.provider === undefined || target.model === undefined) {
        throw new Error('no vision model configured; set the vision provider and model in settings')
      }
      const question = (args.prompt ?? '').trim()
      if (question.length === 0) {
        // The whole point is that the main model crafts the vision question from
        // context; never fall back to a canned description.
        throw new Error('understand_image requires a context-derived `prompt`')
      }
      const mediaType = EXTENSION_TO_MEDIA[path.extname(args.path).toLowerCase()]
      if (mediaType === undefined) {
        throw new Error(`unsupported image extension in "${args.path}"`)
      }
      const data = await readFile(args.path, {
        signal: exec.signal,
      })
      const input: SaveImageAttachment = {
        data,
        mediaType,
        name: path.basename(args.path),
      }
      const [ref] = await ctx.attachments.saveImages([input])
      const user = createUserMessage({
        source: { kind: 'plugin', plugin: PLUGIN_NAME },
        content: [
          { type: 'text', text: question },
          { type: 'image', attachment: ref },
        ],
      })
      const answer = await streamVisionText(ctx, {
        provider: target.provider,
        model: target.model,
        system: target.systemPrompt,
        maxTokens: target.maxTokens,
        messages: [user],
        signal: exec.signal,
      })
      return answer
    },
  }))
}

async function streamVisionText(
  ctx: Context,
  options: {
    provider: string
    model: string
    system: string
    maxTokens: number
    messages: Parameters<typeof ctx.llm.stream>[0]['messages']
    signal: AbortSignal
  },
): Promise<string> {
  const chunks = ctx.llm.stream({
    provider: options.provider,
    model: options.model,
    system: options.system,
    messages: options.messages,
    maxTokens: options.maxTokens,
    signal: options.signal,
  })
  let text = ''
  let failure: string | undefined
  for await (const chunk of chunks) {
    switch (chunk.type) {
      case 'text-delta':
        text += chunk.text
        break
      case 'finish':
        if (chunk.reason.kind === 'error') {
          failure = chunk.reason.failure?.message ?? 'vision model stream failed'
        } else if (chunk.reason.kind === 'aborted') {
          failure = 'vision model stream aborted'
        }
        break
      default:
        break
    }
  }
  if (failure !== undefined) throw new Error(failure)
  return text
}