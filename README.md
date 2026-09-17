# vision-proxy

A [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/) plugin that
gives **text-only main models** image-understanding skills by delegating to a small
multimodal model, and **backs off entirely** when the active model itself declares
multimodal input.

It installs a model-facing tool, `understand_image`, that reads an image and calls a
configured small multimodal model through `ctx.llm.stream`, returning a textual
description the text-only main model can reason about.

## How it works (verified against dsh source)

DeepSeek Harness already declares a per-model vision capability field:
`inputModalities?: ('text' | 'image')[]` on the resolved model info
(`ctx.llm.resolveModelInfo`), and the harness engine already projects image bytes away
for routes whose `inputModalities` does not include `image` — so image bytes never reach
a text-only model. This plugin therefore never touches message rewriting; it adds the
compensating path:

1. **`understand_image` tool** — reads an image path, admits it via `ctx.attachments.saveImages`,
   and streams a one-shot multimodal request to the configured vision model via
   `ctx.llm.stream`. The description returns as a `TextBlock` so the text-only model
   continues normally.
2. **Advisory guidance** — for agents whose active model is text-only (or undeclared, the
   conservative default), it emits a system-prompt context telling the model it can
   inspect referenced images with `understand_image`. Vision-capable models get nothing,
   so the proxy never interferes with native multimodal use (the back-off).

## Configuration (`settings` → namespace `vision`)

| Field | Type | Default | Meaning |
|---|---|---|---|
| `enabled` | boolean | `true` | Master switch. |
| `visionProvider` | string | `''` | Provider route of the small multimodal model (one of dsh's configured models). |
| `visionModel` | string | `''` | Exact model id of the small multimodal model. |
| `visionSystemPrompt` | string | built-in | System prompt the vision model follows. |
| `maxTokens` | natural | `2048` | Max output tokens for a vision call. |
| `guidanceInjection` | boolean | `true` | Emit text-only guidance for text models. |
| `overrides` | `{model, modality}[]` | `[]` | Explicit per-model modality; consulted ahead of adapter metadata (back-off source). |

The card (browser half) reads the vision namespace and lets you pick `visionProvider` /
`visionModel` from the models dsh already has configured — no second model registry.

## Versions

Compatible with dsh `0.1.5-rc.2` and `0.1.6-alpha.1`; peer range
`^0.1.6-alpha.1` (baseline `>=0.1.5-rc.2 <0.2.0`) and `@deepseek-ai/cordis ^4.0.1`.

## Build

The **Host half** builds standalone:

```sh
pnpm install
pnpm build      # tsdown (lib/index.js) + tsc --emitDeclarationOnly (lib/types)
pnpm typecheck  # Host type check
```

Mount it from a profile (e.g. a `cordis.patch.yml`) the same way you mount any tree-out
plugin bundle.

## Known limitation: web card bundle

The **browser half** (`src/client`) cannot be built as a standalone loadable bundle:
dsh discovers client plugins through its monorepo `tsdown.client` preset and browser
`module-loader`, whose format a standalone package cannot reproduce. Ship this package
inside the DeepSeek Harness monorepo and build with the shared `clientBundle` preset to
produce `lib/client.js`. The card source in `src/client/` follows the official
settings-card cookbook contract and is the integration scaffold to finalize there.

## Layout

- `src/config.ts` — settings schema for the `vision` namespace.
- `src/capability.ts` — modality resolution (`ctx.llm.resolveModelInfo` + `overrides`).
- `src/tool-understand-image.ts` — the `understand_image` tool.
- `src/index.ts` — Host `apply`: settings + tool + guidance, with per-agent back-off.
- `src/client/` — browser settings card (req web UI).