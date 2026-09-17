import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type { ImageAttachmentRef, ImageMediaType, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock, StreamChunk } from '@deepseek-ai/dsh-llm'
import { PLUGIN_NAME } from './config.js'

const EXTENSION_TO_MEDIA: Record<string, ImageMediaType> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/** Collect image attachment refs from message content, including nested tool results. */
function collectImageRefs(blocks: readonly ContentBlock[], into: ImageAttachmentRef[]): void {
  for (const block of blocks) {
    if (block.type === 'image') {
      into.push(block.attachment)
      continue
    }
    if (block.type === 'tool-result') {
      collectImageRefs((block as { content: readonly ContentBlock[] }).content, into)
    }
  }
}

/**
 * Image attachments referenced by this session's conversation, most recent
 * first. Pasted images enter the log as durable attachment references inside
 * user messages; the engine replaces them with text placeholders only at
 * LLM-request time, so the log always holds the real references.
 */
export function conversationImages(ctx: Context, agent: Agent | undefined): ImageAttachmentRef[] {
  if (agent === undefined) return []
  const session = ctx.sessions.get(agent.id)
  if (session === undefined) return []
  const refs: ImageAttachmentRef[] = []
  for (const message of session.deriveMessages()) {
    collectImageRefs(message.content, refs)
  }
  return refs.reverse()
}

/**
 * Model-facing tool that answers image-understanding questions by dispatching a
 * one-shot multimodal request to the configured small vision model. It is the
 * compensation path for text-only main models: they never receive image bytes
 * (the harness projects images away for such routes), so they call this tool
 * to obtain a textual description through the vision model. Without `path` it
 * inspects the most recent image in the conversation — the typical case for a
 * pasted screenshot the model only ever saw as a text-only placeholder.
 */
export function registerUnderstandImageTool(ctx: Context, resolveVisionTarget: () => {
  provider?: string
  model?: string
  systemPrompt: string
  maxTokens: number
}) {
  const tools: Array<() => void> = []
  tools.push(ctx.tools.register(defineTool({
    name: 'understand_image',
    description:
      'Inspect an image against a specific question and return a focused textual '
      + 'answer. Use this when a conversation message shows an image placeholder '
      + 'such as "[image omitted because this model accepts text only; …]" or '
      + 'references an attached or available image that you cannot see directly. '
      + 'Omit `path` to inspect the most recent image in this conversation (the '
      + 'usual case for a just-pasted image), or pass the exact file path of a '
      + 'specific image (see `list_conversation_images`). The `prompt` must be the '
      + 'question you actually need answered given your task and the ongoing '
      + 'conversation — NOT a generic "describe the image" instruction. Include '
      + 'the relevant conversational context inside `prompt` so the vision model '
      + 'can answer precisely.',
    parameters: {
      path: {
        type: 'string',
        description:
          'Readable absolute path of the image file to inspect. Omit to inspect '
          + 'the most recent image in this conversation.',
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
    async execute(args: { path?: string; prompt?: string }, exec) {
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

      let attachment: { type: 'image'; attachment: ImageAttachmentRef }
      if (args.path !== undefined && args.path.trim() !== '') {
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
        attachment = { type: 'image', attachment: ref }
      } else {
        const refs = conversationImages(ctx, exec.agent)
        if (refs.length === 0) {
          throw new Error(
            'no image found in this conversation; pass the absolute `path` of an '
            + 'image file instead',
          )
        }
        // Reuse the durable reference already in the session log — no re-read.
        attachment = { type: 'image', attachment: refs[0] }
      }

      const user = createUserMessage({
        source: { kind: 'plugin', plugin: PLUGIN_NAME },
        content: [
          { type: 'text', text: question },
          attachment,
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
  })))

  tools.push(ctx.tools.register(defineTool({
    name: 'list_conversation_images',
    description:
      'List the images referenced so far in this conversation, most recent first, '
      + 'with a host file path when one is available. Use it to pick a specific '
      + 'image before calling `understand_image` with `path`.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value: string): ContentBlock[] => [{ type: 'text', text: value }],
    },
    async execute(_args: Record<string, never>, exec) {
      const refs = conversationImages(ctx, exec.agent)
      if (refs.length === 0) return 'No images are referenced in this conversation.'
      return refs.map((ref, index) => {
        const name = ref.name ?? ref.attachmentId
        const hostPath = ctx.attachments.imageHostPath(ref)
        return `${index + 1}. ${name} (${ref.width}x${ref.height}, ${ref.mediaType})`
          + (hostPath === undefined ? '' : ` — ${hostPath}`)
      }).join('\n')
    },
  })))

  return () => {
    for (const unregister of tools) unregister()
  }
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
