# 架构约定

## 三层结构

Cagent 由三个独立部分组成，有两种运行模式：

### 开发模式

```
浏览器 (localhost:5173)
    │  WebSocket (ws://localhost:4120)
    ▼
server/src/ (Express + ws)
    │  pi SDK
    ▼
AI 模型 (Anthropic / OpenAI)
```

- `client/` — Vite 开发服务器，端口 5173
- `server/` — tsx watch 热重载，端口 4120
- 两者通过 WebSocket 直连

### 桌面应用模式（打包后）

```
Electron 窗口
    │  file:// 加载 client/dist/index.html
    │  WebSocket (ws://localhost:4120)
    ▼
electron/server.cjs (内嵌 server，fork 子进程)
    │  pi SDK
    ▼
AI 模型
```

- Electron 主进程 fork `server.cjs` 作为子进程
- `server.cjs` 是一个独立的 CJS 文件，包含了 Express + WebSocket + pi SDK
- 前端静态文件从 `client/dist/` 加载

## 前端：React + TypeScript + Vite

### 组件树

```
App
├── Sidebar          # 侧边栏（会话列表、API Key 设置）
└── main
    ├── chat-header  # 连接状态、模型名称
    ├── messages     # 消息列表（用户/助手/错误）
    │   ├── message-content  # 文本内容（支持 Markdown）
    │   └── tool-block       # 工具调用展示（可折叠）
    └── input-container      # 输入框 + 发送按钮
```

### 状态管理

不使用状态管理库（Redux/Pinia）。所有状态在 `App.tsx` 中通过 `useState` + `useRef` 管理：

| 状态 | 类型 | 说明 |
|------|------|------|
| `messages` | `Message[]` | 聊天消息列表 |
| `input` | `string` | 输入框文本 |
| `sending` | `boolean` | 是否正在发送/等待回复 |
| `streaming` | `boolean` | 是否正在接收流式 token |
| `apiKey` | `string` | 用户 API Key（localStorage 持久化） |
| `initDone` | `boolean` | 服务端初始化是否完成 |
| `connected` | `boolean` | WebSocket 连接状态 |

### WebSocket 通信

统一通过 `useWebSocket` hook：

- `send(type, payload)` — 发送消息
- `subscribe(type, handler)` — 订阅消息类型，返回取消订阅函数
- 自动重连（断开后 2 秒）

## 后端：WebSocket 消息协议

### 客户端 → 服务端

| type | payload | 说明 |
|------|---------|------|
| `session:init` | `{}` | 初始化会话（触发 pi SDK 加载） |
| `session:prompt` | `{ text }` | 发送用户消息 |
| `session:abort` | `{}` | 中止当前回复 |
| `auth:set-key` | `{ provider, apiKey }` | 设置 API Key |
| `auth:providers` | `{}` | 查询可用提供商 |
| `session:list` | `{}` | 获取会话列表（暂未实现） |

### 服务端 → 客户端

| type | payload | 说明 |
|------|---------|------|
| `session:ready` | `{}` | 初始化完成 |
| `token` | `{ text }` | 流式 token |
| `message:user` | `{ text }` | 用户消息回显 |
| `message:done` | `{}` | 回复完成 |
| `message:aborted` | `{}` | 回复被中止 |
| `tool:call` | `{ name, params }` | 工具调用开始 |
| `tool:result` | `{ name, output }` | 工具调用结果 |
| `auth:key-ready` | `{ provider, models }` | API Key 设置成功 |
| `auth:providers` | `string[]` | 可用提供商列表 |
| `error` | `{ message }` | 错误消息 |

## pi SDK 集成

### 初始化流程

1. `import("@earendil-works/pi-coding-agent")` — ESM 动态导入
2. `pi.SessionManager.inMemory()` — 创建内存会话管理器
3. `pi.ModelRuntime.create()` — 初始化模型运行时（加载配置、模型目录）
4. `modelRuntime.setRuntimeApiKey("anthropic", apiKey)` — 设置 API Key
5. `modelRuntime.getAvailable("anthropic")` — 刷新可用模型列表

### 发送 prompt 流程

1. `pi.createAgentSession({ sessionManager, modelRuntime, model, cwd })` — 创建 agent 会话
2. `session.prompt(text, { signal, onToken, onToolCall, onToolResult })` — 发送消息
3. 回调函数将结果通过 WebSocket 推送到前端

## 重要约束

- **不要引入 React Router**：当前只有一个聊天视图，无需路由
- **electron/server.cjs 与 server/src/ 保持同步**：两者功能一致，只是模块格式不同（CJS vs ESM）
- **error payload 必须是 `{ message: string }`**：前端错误处理依赖此格式
- **API Key 通过 `setRuntimeApiKey` 设置**：不要直接操作 credential store
