# vision-proxy

一个 [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/) 插件，让**纯文本主模型**具备识图能力：把图片理解委托给一个小参数多模态模型；当活跃模型自身声明支持多模态输入时，插件**完全退避**、不影响其原生使用。

插件注册一个面向模型的能力工具 `understand_image`：读取图片后通过 `ctx.llm.stream` 调用配置好的小参数多模态模型，返回一段文本描述，供纯文本主模型继续推理。

## 工作原理（已对照 dsh 源码核实）

DeepSeek Harness 已在解析出的模型信息 `ctx.llm.resolveModelInfo` 上声明了每个模型的视觉能力字段 `inputModalities?: ('text' | 'image')[]`，并且引擎对 `inputModalities` 不含 `image` 的路由会**把图片字节投影掉**——因此图片字节永远不会到达纯文本模型。本插件不触碰消息改写，只是补上补偿路径：

1. **`understand_image` 工具**——读取图片路径 → 经 `ctx.attachments.saveImages` 入库 → 经 `ctx.llm.stream` 发起一次面向视觉模型的多模态请求。描述以 `TextBlock` 返回，纯文本模型可以正常继续。
2. **文本路径指导**——对于活跃模型为纯文本（或未声明、采取保守默认值）的 agent，注入一段系统提示上下文，告诉模型可以用 `understand_image` 来查看被引用的图片。视觉能力模型不获得任何注入，因此代理从不干扰原生多模态使用（即退避）。

## 配置（`settings` → 命名空间 `vision`）

| 字段 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `enabled` | boolean | `true` | 总开关。 |
| `visionProvider` | string | `''` | 小参数多模态模型的提供方路由（dsh 已配置模型之一）。 |
| `visionModel` | string | `''` | 小参数多模态模型的精确模型 id。 |
| `visionSystemPrompt` | string | 内置 | 视觉模型每次调用遵循的系统提示词。 |
| `maxTokens` | natural | `2048` | 视觉调用最大输出 token 数。 |
| `guidanceInjection` | boolean | `true` | 是否为纯文本模型注入识图指导。 |
| `overrides` | `{model, modality}[]` | `[]` | 按模型显式声明的模态；优先级高于适配器元数据（退避依据）。 |

设置卡片（浏览器端）读取 `vision` 命名空间，让你**从 dsh 已配置的模型中**选择 `visionProvider` / `visionModel`——不建立第二套模型注册表。

## 版本

兼容 dsh `0.1.5-rc.2` 与 `0.1.6-alpha.1`；peer 范围 `^0.1.6-alpha.1`（基线 `>=0.1.5-rc.2 <0.2.0`），`@deepseek-ai/cordis ^4.0.1`。

## 构建

**Host 半侧**可独立构建：

```sh
pnpm install
pnpm build      # tsdown（lib/index.js）+ tsc --emitDeclarationOnly（lib/types）
pnpm typecheck  # Host 类型检查
```

从某个 profile（例如在 `cordis.patch.yml`）以挂载任意树外插件 bundle 的方式挂载它。

## 已知限制：web 卡片 bundle

**浏览器半侧**（`src/client`）无法以独立包的形式产出可加载 bundle：dsh 通过其仓库内的 `tsdown.client` 预设与浏览器 `module-loader` 发现客户端插件，该输出格式独立包无法复刻。请把本包放入 DeepSeek Harness monorepo 内，用共享的 `clientBundle` 预设构建以生成 `lib/client.js`。`src/client/` 中的卡片按官方「新增设置卡片」Cookbook 契约编写，是待在此处落地的集成脚手架。

## 目录

- `src/config.ts` — `vision` 命名空间的设置 schema。
- `src/capability.ts` — 模态判定（`ctx.llm.resolveModelInfo` + `overrides`）。
- `src/tool-understand-image.ts` — `understand_image` 工具。
- `src/index.ts` — Host `apply`：设置 + 工具 + 指导，按 agent 能力退避。
- `src/client/` — 浏览器设置卡片（web UI）。