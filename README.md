# dsh-vision-tool

一个 [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/) 插件：为**纯文本主模型**补上识图能力。它把图片理解委托给你配置的一个小参数多模态模型，再把结果以文本形式交还给主模型；当活跃模型自身支持图片输入时，插件**完全退避**，原生多模态体验不受任何影响。

## 这个插件干了什么

DeepSeek Harness 的引擎依据模型声明的 `inputModalities` 做字节投影：路由不含 `image` 的模型（纯文本模型）永远收不到图片字节——用户贴进会话的截图，纯文本主模型是"看不见"的。此外，宿主在消息准入时会把带图消息对纯文本模型**整条拒绝**（`MODEL_DOES_NOT_SUPPORT_IMAGES`），文本模型连消息都收不到。本插件不碰请求消息改写，补上三条补偿路径：

1. **放行带图消息**——放宽会话消息准入的图片门（包装 `llm.resolveModelInfo` 服务方法，见下文实现说明），让贴图消息进入纯文本模型的会话；引擎仍按适配器真实元数据把图片字节投影为文本占位符，不会把图片字节发给文本模型。
2. **注册 `understand_image` / `list_conversation_images` 工具**——`understand_image` 不带 `path` 时自动检查会话中最近的一张图（正是"刚贴图"的典型场景），带 `path` 则读取指定文件；经 `ctx.attachments.saveImages` 入库 → `ctx.llm.stream` 向配置好的小参数多模态模型发起一次多模态请求 → 把回答以文本块返回，主模型据此继续推理。`list_conversation_images` 列出会话中出现过的全部图片供挑选。
3. **注入识图指导**——对纯文本 agent，在系统提示中注入一段指导：看到 `[image omitted because this model accepts text only; …]` 占位符就意味着图片可用 `understand_image` 检查，且 `prompt` 必须是从当前任务和对话中提炼出的具体问题，而不是笼统的"描述这张图"。
4. **按能力退避**——活跃模型声明了图片能力、或被用户显式标记为多模态时，不注入任何指导，也绝不触碰原生图片路径。

## 特性

- **零干扰退避**：模态判定优先级为 用户 `overrides` > 适配器声明的 `inputModalities`（`ctx.llm.resolveModelInfo`，按 provider/model 路由缓存一次）> 保守默认（视作纯文本，与引擎投影行为一致）。判定为多模态的模型不注入任何指导；`resolveModelInfo` 尚未返回的该路由首轮会话按保守默认处理，此后按缓存判定。
- **贴图即用**：放宽宿主对带图消息的准入拒绝后，直接贴图提问即可——纯文本主模型看到占位符后会自主调用 `understand_image`（不带 `path`），无需用户指明文件路径。
- **高质量识图**：工具强制要求主模型传入结合上下文的具体问题，拒绝空 `prompt`、不做"笼统描述"兜底；视觉模型系统提示要求"精确完整描述 + 逐字转录可见文本"。
- **官方风格设置卡片**：卡片与 dsh 内置插件卡片同观感——可折叠标题、暂存编辑 + 保存/放弃、保存后自动收起;保存后的修改即时作用于后续请求（读穿透 `setSource`），无需重启会话。
- **从既有模型中选型**：设置卡片通过 `remote.session.modelCatalog()` 读取 dsh 的 Host 代模型目录，`visionProvider` / `visionModel` 直接从 dsh 已配置的模型里选，不建立第二套模型注册表；目录不可用时降级为手动输入。
- **可关的指导注入**：`guidanceInjection` 可单独关闭系统提示指导，只保留工具本身。
- **支持常见图片格式**：png / jpg / jpeg / webp / gif。
- **随请求中止**：视觉流式调用跟随工具执行的 AbortSignal，取消即中断。
- **干净卸载**：工具与指导均随插件 dispose 注销。

## 怎么使用

### 1. 安装

#### 方式 A：作为 dsh 插件从 GitHub 安装

在目标 dsh 环境里执行（`<profile>` 换成你的 profile 名）：

```sh
dsh plugin --profile <profile> add github:YJLTF/dsh-vision-tool
```

与 dsh 官方打包安装文档一致，有三点注意：

- **构建授权**：git 安装拉取的是源码而非构建产物，装完会由包内的 `prepare` 脚本构建出 `lib/index.js`。pnpm ≥ 10 默认拒绝为 git 依赖运行 `prepare`，首次 `add` 会失败——按 `dsh` 的提示，在 profile 的 `pnpm-workspace.yaml` 里放行后重试：
  ```yaml
  allowBuilds:
    dsh-vision-tool: true
  ```
- **安全与钉版本**：放行构建即允许该包代码在安装期于你机器上执行，请只对可信的包放行；建议钉住 commit：
  ```sh
  dsh plugin --profile <profile> add github:YJLTF/dsh-vision-tool#<commit-sha>
  ```
- **层激活**：本包已声明 `dsh.bundle`（`cordis.patch.yml` + 挂载清单），`dsh plugin add` 安装后会自动作为 profile 层激活，无需手工改 patch 文件；若安装时日志出现 `declares no dsh.bundle — installed as a plain dependency` 警告，说明装到的是旧版本，请更新后重装。

#### 方式 B：从源码构建并挂载

```sh
git clone https://github.com/YJLTF/dsh-vision-tool
cd dsh-vision-tool
pnpm install
pnpm build      # tsdown（lib/index.js）+ tsc --emitDeclarationOnly（lib/types）+ 客户端 bundle（lib/client.js）
pnpm typecheck  # Host 类型检查（typecheck:client 为浏览器半侧）
```

然后在 dsh 的 profile（例如 `cordis.patch.yml`）中以挂载任意树外插件 bundle 的方式挂载 `lib/index.js`。

> 两种方式产出的 Host 半侧完全相同；客户端 bundle（`lib/client.js`）由 `scripts/build-client.mjs` 在本仓库内独立构建，随 `pnpm build` / `prepare` 一并产出。

### 2. 配置（`settings` → 命名空间 `vision`）

| 字段 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `enabled` | boolean | `true` | 总开关。 |
| `visionProvider` | string | `''` | 小参数多模态模型的提供方路由（从 dsh 已配置模型中选）。 |
| `visionModel` | string | `''` | 小参数多模态模型的精确模型 id。 |
| `visionSystemPrompt` | string | 内置 | 视觉模型每次调用遵循的系统提示词。 |
| `maxTokens` | number | `2048` | 视觉调用最大输出 token 数（256–8192）。 |
| `guidanceInjection` | boolean | `true` | 是否为纯文本模型注入识图指导。 |
| `overrides` | `{model, modality}[]` | `[]` | 按模型显式声明模态；优先级高于适配器元数据（退避依据）。 |

推荐在 dsh web 端 **Settings → 插件 → 插件配置** 的 "识图代理" 卡片中配置：卡片为暂存式编辑——改动后点 **保存** 一次写回（立即生效、无需重启），**放弃** 丢弃草稿。识图模型从下拉里选（列表即 dsh 已配置的全部模型，可用"刷新列表"重读），下方文本框同步显示当前选择；`overrides` 声明也可在卡片里增删。**最小可用配置就是 provider / model 两项**——任一为空时，`understand_image` 会报错提示"未配置视觉模型"，指导也不会注入。

**必须的前置条件**：所选的视觉模型要在 dsh 的模型配置（`settings.yaml` 的 provider `models` 列表）里声明图片输入能力，否则引擎会把发往视觉模型的请求中的图片字节一并投影掉——视觉模型只会看到一个 `sha256:` 占位符，无法真正识图：

```yaml
llm-pi-ai:
  providers:
    <provider>:
      models:
        - id: <vision-model>
          input: [text, image]   # 关键：声明后引擎才放行图片字节
```

同理，`overrides` 中把某个模型标记为 `image` 也能达到同样效果（并触发本插件对该模型退避）。

### 3. 运行时行为

配置完成后，在会话里**直接贴图提问即可**：纯文本主模型收到的图片是一个文本占位符，系统提示中的指导会告诉它占位符背后的图片可以检查——它会自主调用：

```json
{ "prompt": "结合当前任务与对话的具体问题" }
```

（省略 `path` 时检查会话中最近的一张图；多图场景模型可先调 `list_conversation_images` 挑选。）工具返回视觉模型的文本回答，主模型据此继续推理。若你的主模型本身支持图片输入，装不装这个插件没有区别——准入不拦、指导不注入、消息不改写。

## 版本兼容

兼容 dsh `0.1.5-rc.2` 与 `0.1.6-alpha.1`；peer 范围 `^0.1.6-alpha.1`（基线 `>=0.1.5-rc.2 <0.2.0`），`@deepseek-ai/cordis ^4.0.1`。

## 实现说明：准入放行与客户端 bundle 格式

**准入放行**：宿主在 `session/prompt` 准入时通过 `llm.resolveModelInfo` 服务方法判定模型能力，声明不含 `image` 的路由会收到 `MODEL_DOES_NOT_SUPPORT_IMAGES` 整条拒绝。本插件包装该服务方法，对这类路由在元数据中补报 `image` 能力使准入放行；而请求层的字节投影读取的是适配器自身元数据（不经过该方法），行为不变——纯文本模型的请求里图片仍是文本占位符。原生多模态路由不受影响，其它消费方（ACP、子代理等）最多元数据展示失真，行为上有投影兜底。插件卸载时恢复原方法；若服务门面不可写则跳过放行，其余功能不受影响。未来若 dsh 提供官方的准入开关，应迁移过去。

**客户端 bundle**:dsh web 通过模块加载器按 `dsh.client` 声明发现客户端插件，加载的是懒 CJS 包装格式（`window.__ModuleLoader__.load({ id, factory: (require) => … })`），`@deepseek-ai/*` 与 `react` 保持外部化、由加载器的 `require` 在启动模块图中解析。`scripts/build-client.mjs` 用 rolldown 复刻了这一输出形态：`src/client` 打包为 CJS、外部化官方依赖后套上包装写入 `lib/client.js`。卡片遵循官方「新增设置卡片」Cookbook 的键控 slot 契约（`settings.plugin.item`，以设置命名空间为键，与 Host 侧 `installSection` 注册的命名空间自动配对）。

## 目录

- `src/meta.ts` — 无依赖共享常量（命名空间 / 插件名 / 默认提示词），供两侧安全复用。
- `src/config.ts` — `vision` 命名空间的设置 schema。
- `src/capability.ts` — 模态判定（`ctx.llm.resolveModelInfo` + `overrides`）。
- `src/tool-understand-image.ts` — `understand_image` 工具。
- `src/index.ts` — Host `apply`：设置 + 工具 + 指导，按 agent 能力退避。
- `src/client/` — 浏览器设置卡片（web UI）。
- `scripts/build-client.mjs` — 客户端 bundle 构建（ModuleLoader 包装格式）。
