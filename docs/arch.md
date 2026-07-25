# 架构约定

## 三层结构

Cagent 由 React 渲染进程、Electron 主进程和 pi RPC 子进程组成。`server/` 与 `electron/server.cjs` 是未接入当前 GUI 的遗留 WebSocket 实现，不能作为运行时回退链路。

### 当前桌面链路（主路径）

```
React GUI（Electron renderer）
    │  Electron IPC（contextBridge）
    ▼
Electron 主进程
    │  JSON Lines stdin/stdout RPC
    ▼
pi-coding-agent runtime
    │  providers / auth / tools / skills / extensions / sessions
    ▼
AI 模型（pi 支持的 provider）
```

- 开发时 Electron 加载 `http://localhost:5173`，生产时加载 `client/dist/index.html`
- Electron 主进程负责启动、停止和重启 pi RPC，并将事件转发给 renderer
- `electron/ccswitch-provider.cjs` 通过 pi extension 注入 ccswitch provider

### 未接线的遗留实现

```
server/src/             electron/server.cjs
    │                           │
    └── 旧 WebSocket 代码 ──────┘
                X
        当前 client 没有连接入口
```

- `server/src/` 可以独立启动 Express + WebSocket server，但当前 client 不会连接它
- `electron/server.cjs` 是旧 CJS 版本，当前 `electron/main.cjs` 不会启动它
- 这些文件只用于历史源码对照；除非先设计并实现真实接线，否则不得称为运行时回退或用它验收桌面功能

## 工作台服务

桌面工作台通过 `preload.cjs` 暴露最小 `workspace` IPC。文件树、预览、Git 状态和终端请求均由 Electron 主进程执行；路径会解析并限制在当前 `cwd` 内，`release`、`.git` 和 `node_modules` 不作为默认项目内容展示。Git 写入、分支创建、提交和终端命令先返回审批请求，renderer 不接触 Node API。

Worktree 创建使用目录选择器选择项目外 sibling 目标，校验目标不存在或为空、分支不存在后，以 `git worktree add -b codex/<name> <target> <start-ref>` 创建。项目切换会先终止旧终端并清理审批；新 pi cwd 启动失败时恢复旧 RPC/cwd。

## Pi 工具权限闸门

`electron/permission-gate.cjs` 作为 pi RPC extension 在所有 provider extension 前加载，监听 `tool_call`。它校验 `read/write/edit` 的路径是否位于当前 cwd，并将写入、越界访问、提权/破坏性 bash、外部网络和安装命令按 `ask/allow/block` 策略处理。`ask` 通过 pi 的 `ctx.ui.select` 产生 `extension_ui_request`，沿用现有 `extension_ui_response` 一次性 request id；无 UI 时统一 block。策略可通过 `CAGENT_PERMISSION_POLICY` JSON 覆盖。

## 前端：React + TypeScript + Vite

### 组件树

```
App
├── activity-rail    # 主导航、会话/设置入口、Inspector 切换
├── Sidebar          # pi 会话、Provider、凭据和 MCP 能力说明
├── main
│   ├── RuntimeBar   # 模型、thinking、compact 和运行状态
│   ├── messages     # Markdown、thinking、工具调用与图片
│   ├── AgentConsole # commands、usage、tree、fork/clone、bash
│   └── input        # 输入、slash command、steer/follow-up
└── Inspector
    ├── WorkspacePanel # Files、Git、Terminal
    ├── ResourceCenter # Skills、prompts、extensions、commands、导出
    └── UsagePanel
```

### 状态管理

不使用状态管理库（Redux/Pinia）。所有状态在 `App.tsx` 中通过 `useState` + `useRef` 管理：

| 状态 | 类型 | 说明 |
|------|------|------|
| `messages` | `Message[]` | 聊天消息列表 |
| `input` | `string` | 输入框文本 |
| `sending` | `boolean` | 是否正在发送/等待回复 |
| `streaming` | `boolean` | 是否正在接收流式 token |
| `provider` | `string` | 当前选择的 Provider（localStorage 仅保存非敏感选择） |
| `providerStates` | `ProviderState[]` | pi runtime 报告的凭据来源、能力和模型状态，不含密钥正文 |
| `initDone` | `boolean` | pi RPC 初始化是否完成 |
| `connected` | `boolean` | Electron IPC bridge 是否可用 |

### Electron IPC 通信

统一通过 `useWebSocket` hook（保留旧 API 名称以减少 UI 改动）：

- `send(type, payload)` — 调用 preload 暴露的 `window.cagent.pi.send`
- `subscribe(type, handler)` — 订阅主进程转发的事件
- 不在 renderer 中直接连接端口或访问 Node.js API

## pi RPC 协议适配

### GUI → 主进程 → pi

| type | payload | 说明 |
|------|---------|------|
| `session:init` | `{}` | 查询 pi 状态和可用模型 |
| `session:prompt` | `{ text, model, images? }` | 调用 pi `prompt` |
| `session:abort` | `{}` | 调用 pi `abort` |
| `session:steer` | `{ text, images? }` | 生成中插入 steering 消息 |
| `session:follow-up` | `{ text, images? }` | 将消息排到当前生成 settled 后 |
| `session:new` | `{}` | 调用 pi `new_session` 并刷新运行状态 |
| `session:list` | `{}` | 读取当前项目的 pi 持久化会话列表 |
| `session:switch` | `{ path }` | 校验并调用 pi `switch_session`，加载该会话历史 |
| `session:set-thinking` | `{ level }` | 调用 pi `set_thinking_level` |
| `session:set-auto-compaction` | `{ enabled }` | 更新 pi 自动压缩开关 |
| `session:compact` | `{}` | 调用 pi `compact` 压缩当前上下文 |
| `session:stats` | `{}` | 查询当前 pi 会话统计信息 |
| `session:tree` | `{}` | 读取当前会话的持久化分支树 |
| `session:fork-messages` | `{}` | 读取可供 fork 的用户消息 entry |
| `session:fork` | `{ entryId }` | 从指定用户消息创建分支会话 |
| `session:clone` | `{}` | 在当前 leaf 克隆会话 |
| `auth:set-key` | `{ provider, apiKey, mode }` | 按 stored/session 模式设置凭据并重启 pi RPC |
| `auth:providers` | `{}` | 查询 pi 可用 provider |
| `auth:status` | `{}` | 查询 provider 凭据来源、配置状态和模型可用性（不含密钥） |
| `auth:oauth` | `{ provider }` | 调用 `ModelRuntime.login(provider, "oauth")` 并转发交互事件 |
| `auth:clear` | `{ provider }` | 调用 `logout` / `removeRuntimeApiKey` 移除对应凭据并重启 RPC |
| `mcp:list` | `{}` | 返回 pi 0.81.1 不支持 built-in MCP 的明确能力边界 |

### pi 事件 → GUI

| type | payload | 说明 |
|------|---------|------|
| `session:ready` | `{}` | 初始化完成 |
| `token` | `{ text }` | 流式 token |
| `thinking:delta` | `{ text }` | 独立于正文的流式思考内容 |
| `message:user` | `{ text }` | 用户消息回显 |
| `message:done` | `{}` | 回复完成 |
| `session:state` | `{ sessionId, sessionName?, thinkingLevel, autoCompactionEnabled, messageCount, cwd, ... }` | 当前 pi 会话运行状态 |
| `session:list` | `PiSession[]` | 当前项目的 pi 持久化会话，`id` 与 `path` 都是会话文件路径 |
| `session:messages` | `Message[]` | 当前 pi 会话的已持久化用户和助手消息 |
| `session:thinking-levels` | `string[]` | 当前模型支持的思考等级 |
| `session:stats` | `SessionStats` | 当前 pi 会话统计信息 |
| `tool:call` | `{ name, params }` | 工具调用开始 |
| `tool:result` | `{ name, output }` | 工具调用结果 |
| `tool:update` | `{ id, name, output }` | 运行中工具的部分结果 |
| `session:queue` | `{ steering, followUp }` | 本 GUI 已提交且尚未 settled 的队列投影 |
| `session:tree` | `{ tree, leafId }` | 会话 tree 数据 |
| `session:fork-messages` | `[{ entryId, text }]` | fork 可选的用户消息 |
| `auth:key-ready` | `{ provider, models, source? }` | provider 已有可用凭据 |
| `auth:providers` | `string[]` | 可用提供商列表 |
| `error` | `{ message }` | 错误消息 |

其余未专门映射的 pi 事件通过 `pi:event` 转发，扩展 UI 请求通过 `pi:extension-ui` 转发。

## pi SDK 集成

### 初始化流程

1. Electron 启动 `dist/rpc-entry.js --mode rpc`
2. pi 加载 `~/.pi/agent`、provider、认证、Skills 和 Extensions；pi 0.81.1 不包含 built-in MCP
3. ccswitch 配置通过 extension 和环境变量注入，不复制到 renderer
4. GUI 通过 `get_state`、`get_available_models` 等 RPC 命令初始化

`session:ready` 是一次初始化完成通知，不能触发新的完整初始化。Provider 列表已经随初始化下发；显式 `auth:providers` 查询只能刷新并发布 Provider 列表，不得再次调用 `initializeRendererSession()`，否则会形成 IPC 回环并持续占用 CPU 和内存。

### 发送 prompt 流程

1. 主进程发送 `{ type: "prompt", message, images }`
2. pi 通过 stdout 输出 `message_update`、工具事件和 `agent_settled`
3. 主进程把这些事件映射为 renderer 使用的 `token`、`tool:*` 和 `message:done`；abort 后也在 pi settle 时统一结束，不额外发送 `message:aborted`

生成期间 renderer 允许提交 `steer` 或 `follow-up`。pi RPC 在此版本只暴露待处理数量、不暴露队列内容，因此 GUI 的队列面板只显示由当前 GUI 提交的消息；在 `agent_settled` 时清空该投影。工具状态以 pi 的 `toolCallId` 关联，thinking delta 不得并入 assistant 正文。

Extension 的 RPC UI 事件中，`setWidget` 映射为 editor 上下方的文本 widget，`set_editor_text` 直接更新 renderer 输入框并聚焦；组件工厂、header/footer 等 TUI 专属能力不在 RPC 模式可用范围内。

## 重要约束

- **不要引入 React Router**：当前只有一个聊天视图，无需路由
- **遗留 server 不新增主链路能力**：`electron/server.cjs` 与 `server/src/` 当前未接入 GUI，仅用于历史源码对照
- **error payload 必须是 `{ message: string }`**：前端错误处理依赖此格式
- **敏感凭据不写入 renderer 持久化**：API Key 由 renderer 一次性提交给主进程，再通过 pi `ModelRuntime.login`/runtime API 注入；状态事件只能返回来源和可用性，不能回传密钥正文
- **MCP 能力不得伪造**：在升级到确实提供 MCP 的 pi 版本并完成真实集成前，只显示 unsupported 边界，不扫描配置冒充已连接服务
## 资源中心增量约定

Electron 主进程使用 `DefaultResourceLoader({ noExtensions: true })` 读取 skills/prompts，避免再次执行 extension；extensions 仅以配置路径做静态 inventory，命令和错误来自已运行 RPC。
