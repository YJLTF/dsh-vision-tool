# dsh-vision-tool

一个 [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/) 插件：为**纯文本主模型**补上识图能力。它把图片理解委托给你配置的一个小参数多模态模型，再把结果以文本形式交还给主模型；当活跃模型自身支持图片输入时，插件**完全退避**，原生多模态体验不受任何影响。

## 这个插件干了什么

DeepSeek Harness 的引擎依据模型声明的 `inputModalities` 做字节投影：路由不含 `image` 的模型（纯文本模型）永远收不到图片字节——用户贴进会话的截图，纯文本主模型是"看不见"的。此外，宿主在消息准入时会把带图消息对纯文本模型**整条拒绝**（`MODEL_DOES_NOT_SUPPORT_IMAGES`），文本模型连消息都收不到。本插件不碰请求消息改写，补上三条补偿路径：

1. **放行带图消息**——放宽会话消息准入的图片门（包装 `llm.resolveModelInfo` 服务方法，见下文实现说明），让贴图消息进入纯文本模型的会话；引擎仍按适配器真实元数据把图片字节投影为文本占位符，不会把图片字节发给文本模型。
2. **注册 `understand_image` / `list_conversation_images` 工具**——`understand_image` 不带 `path` 时自动检查会话中最近的一张图（正是"刚贴图"的典型场景），带 `path` 则读取指定文件；经 `ctx.attachments.saveImages` 入库 → `ctx.llm.stream` 向配置好的小参数多模态模型发起一次多模态请求 → 把回答以文本块返回，主模型据此继续推理。`list_conversation_images` 列出会话中出现过的全部图片供挑选。
3. **注入识图指导**——对纯文本 agent，在系统提示中注入一段指导：看到 `[image omitted because this model accepts text only; …]` 占位符就意味着图片可用 `understand_image` 检查，且 `prompt` 必须是从当前任务和对话中提炼出的具体问题，而不是笼统的"描述这张图"。
4. **按能力退避**——活跃模型声明了图片能力、或被用户显式标记为多模态时，不注入任何指导，也绝不触碰原生图片路径。

## 特性

- **零干扰退避**：模态判定优先级为 用户 `overrides` > 适配器声明的 `inputModalities`（`ctx.llm.resolveModelInfo`，按 provider/model 路由缓存一次）> 保守默认（视作纯文本，与引擎投影行为一致）。判定为多模态的模型不注入任何指导；agent 创建时与会话中途切换模型时（`model/selection` 日志事件）都会预热该路由的判定，`resolveModelInfo` 失败的路由下轮自动重试；系统提示指导还会在装配瀑布之后按**实际选中路由**复核一次，因此即使会话中途切换模型，下一轮的指导去留也会跟着正确翻转，而不是停留在创建时的默认模型上。
- **贴图即用**：放宽宿主对带图消息的准入拒绝后，直接贴图提问即可——纯文本主模型看到占位符后会自主调用 `understand_image`（不带 `path`），无需用户指明文件路径。
- **高质量识图**：工具强制要求主模型传入结合上下文的具体问题，拒绝空 `prompt`、不做"笼统描述"兜底；视觉模型系统提示要求"精确完整描述 + 逐字转录可见文本"。
- **volatile 配置段**：本插件的 `Config` schema 整段标记 volatile——在 dsh 0.2.0 的设置模型里，配置改动经设置文档提交后即时生效（Loader 就地把新值提交进运行中 fiber 的活引用，Host 侧 `apply` 每次请求重读），无需重启会话或插件。
- **官方风格配置卡片**：卡片按官方「新增设置页」配方注册进插件管理页的 `plugins.bundle.config` 键控 slot（以包名为键），出现在 web 端顶部「插件」按钮打开的**插件管理页 → 已安装 → dsh-vision-tool 详情页**，与内置插件配置同观感——暂存编辑 + 保存/放弃；模型下拉直接读取 dsh 的 Host 代模型目录（`remote.session.modelCatalog()`，可用「刷新列表」重读），保存后的修改即时作用于后续请求。卡片仅在 Host 服务该条目命名空间期间存在（`ctx.configForms.whileServed`），未组合本插件的部署不留任何痕迹。
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

### 2. 配置（web 配置卡片 / profile 插件条目配置）

自 dsh 0.2.0 起，设置栈不再有插件自注册的命名空间：Loader 直接把插件导出的 `Config` schema 变成 profile 插件条目的配置（条目 id 即包名 `dsh-vision-tool`），schema 标记为 volatile，改动经设置文档提交后即时生效、无需重启。

**推荐入口是 web 端的配置卡片**：顶部「插件」按钮 → 插件管理页 → 已安装 → **dsh-vision-tool** 详情页，配置表单就在页面描述与组件列表之间。卡片为暂存式编辑——改动后点 **保存** 一次原子写回（立即生效、无需重启），**放弃** 丢弃草稿；识图模型从下拉里选（列表即 dsh 已配置的全部模型，可用「刷新列表」重读），下方文本框同步显示当前选择；`overrides` 声明也可在卡片里增删。等价地，直接编辑 profile 的 `cordis.patch.yml`（改文件需重启 dsh 读取一次，之后经卡片/设置文档提交的修订即时生效）：

```yaml
- id: dsh-vision-tool
  name: dsh-vision-tool
  config:
    visionProvider: zai-coding-cn
    visionModel: glm-5.3-flash
    maxTokens: 4096
```

| 字段 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `enabled` | boolean | `true` | 总开关。关闭后指导不注入，两个识图工具都会拒绝执行。 |
| `visionProvider` | string | `''` | 小参数多模态模型的提供方路由（从 dsh 已配置模型中选）。 |
| `visionModel` | string | `''` | 小参数多模态模型的精确模型 id。 |
| `visionSystemPrompt` | string | 内置 | 视觉模型每次调用遵循的系统提示词。 |
| `maxTokens` | number | `2048` | 视觉调用最大输出 token 数（256–8192）。 |
| `guidanceInjection` | boolean | `true` | 是否为纯文本模型注入识图指导。 |
| `overrides` | `{model, modality}[]` | `[]` | 按模型显式声明模态；优先级高于适配器元数据（退避依据）。 |

**最小可用配置就是 provider / model 两项**——任一为空时，`understand_image` 会报错提示"未配置视觉模型"，指导也不会注入。所选视觉模型还须在 dsh 的模型配置里声明图片输入（见下方前置条件）。

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

**v0.3.0 面向 dsh `0.2.0-rc.1`**（`@deepseek-ai/cordis ^4.0.1`；宿主依赖钉 `0.2.0-rc.1`）。dsh 0.2.0 重写了设置栈（插件条目配置 + volatile 热更段）、把工具结果从内容块改为 tool-role 消息、并将消息来源改为"每个生产者自声明 kind"的合并扩展模型，这些均为破坏性变更，**与 0.1.x 不兼容**——dsh `0.1.5-rc.2` – `0.1.6-alpha.2` 用户请安装 v0.1.0（设置栈重写前的最后一线，pin 提交 `40f2fcd`）：`dsh plugin --profile <profile> add github:YJLTF/dsh-vision-tool#40f2fcd`。

**schemastery ≥ 3.18.4**：volatile 热更依赖 `@deepseek-ai/schemastery` 3.18.4 引入的引用协议（schema 标记 volatile 后解析产出 `get()` 活引用，Loader 就地提交热更值）。本包 devDependencies 已钉 `~3.18.4`；若你的运行时把本包解析到更旧的 schemastery，表单仍能渲染、保存也会落盘，但运行中的值不再热更、需重启 dsh 生效。dsh `0.2.0-rc.1` 自身依赖 `~3.18.4`，正常安装不受影响。

## 实现说明：准入放行与配置卡片

**准入放行**：宿主在 `session/prompt` 准入时通过 `llm.resolveModelInfo` 服务方法判定模型能力，声明不含 `image` 的路由会收到 `MODEL_DOES_NOT_SUPPORT_IMAGES` 整条拒绝。本插件包装该服务方法，对这类路由在元数据中补报 `image` 能力使准入放行；而请求层的字节投影读取的是适配器自身元数据（不经过该方法），行为不变——纯文本模型的请求里图片仍是文本占位符。原生多模态路由不受影响，其它消费方（ACP、子代理等）最多元数据展示失真，行为上有投影兜底。插件卸载时恢复原方法；若服务门面不可写则跳过放行，其余功能不受影响。未来若 dsh 提供官方的准入开关，应迁移过去。

**配置卡片**：按官方「新增设置页」配方实现——`package.json` 声明 `dsh.client`（`platform: "web"` + 对 ui-settings / ui-plugin-manager / api-remotes 的加载边），`./client` 导出 lazy-CJS 格式的浏览器 bundle（`scripts/build-client.mjs` 独立复刻 monorepo 的 `tsdown.client` 产物形状）。客户端插件在 Host 服务条目命名空间期间（`ctx.configForms.whileServed`）向 `plugins.bundle.config` 键控 slot 注册（`key` = 包名），并经由共享的 `ctx.configForms.get(条目id)` 表单暂存编辑、以修订围栏的原子 `mutate` 写回。注意 bundle 配置卡片不接收页面宿主的 `form` prop（一个 bundle 可含多个条目，没有单一表单），需要自行取共享表单；注入给组件的快照必须**缓存引用**——React `useSyncExternalStore` 对每次 `getSnapshot` 返回新对象会直接判定无限循环并崩溃。

## 目录

- `src/meta.ts` — 无依赖共享常量（命名空间 / 插件名 / 默认提示词）。
- `src/config.ts` — 插件条目的 `Config` schema（整段 volatile + 中文 i18n 标签：改动即时生效，免重载）。
- `src/capability.ts` — 模态判定（`ctx.llm.resolveModelInfo` + `overrides`）。
- `src/tool-understand-image.ts` — `understand_image` 工具。
- `src/index.ts` — Host `apply`：配置 + 工具 + 指导，按 agent 能力退避；导出 `Config` schema 供 Loader 生成条目表单。
- `src/client/index.ts` — 浏览器半侧：模型目录读取 + `plugins.bundle.config` 卡片注册。
- `src/client/vision-model-card.tsx` — 配置卡片组件（暂存编辑、模型下拉、overrides 编辑）。
- `scripts/build-client.mjs` — 构建 `lib/client.js`（ModuleLoader lazy-CJS 包装格式）。
