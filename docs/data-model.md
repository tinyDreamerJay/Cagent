# 数据模型

本文负责说明桌面主链路中的 renderer 状态、Electron IPC 消息和持久化归属。完整命令清单见 [架构约定](./arch.md)，权限规则见 [业务约束](./business-rules.md)。

## 聊天展示模型

前端展示类型定义在 `client/src/hooks/useConversations.ts`：

```typescript
interface Message {
  id: string;
  role: "user" | "assistant" | "error";
  text: string;
  images?: { data: string; mimeType: string }[];
  toolCalls?: ToolCall[];
  thinking?: string;
}

interface ToolCall {
  id: string; // pi toolCallId
  name: string;
  params: string;
  result?: string;
  status?: "running" | "done" | "error";
  collapsed: boolean;
}
```

- 工具更新必须优先按 `toolCallId` 关联，不能只按工具名匹配并发调用。
- `thinking` 与 assistant 正文分开保存和展示。
- 图片只在当前输入和消息展示中保留；不得把 base64 当作长期会话事实来源。

## IPC 信封

renderer 与 Electron 主进程使用统一信封：

```typescript
interface PiEnvelope<T = unknown> {
  type: string;
  payload?: T;
}
```

renderer 通过 `window.cagent.pi.send(type, payload)` 上行，主进程用 `pi:event` 下行。`client/src/hooks/useWebSocket.ts` 只是保留的旧文件名，当前实现不建立 WebSocket 连接。

主要下行状态：

| type | payload 摘要 |
|---|---|
| `session:ready` | `{ sessionId, sessionFile, cwd }` |
| `session:state` | pi runtime state 加当前 `cwd` |
| `session:list` | `PiSession[]`，`path` 是真实 pi session 文件 |
| `session:messages` | 从 pi 持久化会话恢复的 GUI 消息 |
| `token` / `thinking:delta` | 流式正文 / 独立 thinking 增量 |
| `tool:call/update/result` | 以 `toolCallId` 关联的工具生命周期 |
| `auth:status` | `ProviderState[]`，不含凭据正文 |
| `session:resources` | Skills、prompts、extensions、commands 和 diagnostics |
| `error` | `{ message: string }` |

## Provider 状态

```typescript
interface ProviderState {
  provider: string;
  configured: boolean;
  available: boolean;
  source: string;
  models: string[];
  capabilities: { apiKey: boolean; oauth: boolean };
  error?: string;
}
```

Provider 状态只说明凭据来源和能力。API Key 本身只作为一次性 IPC 输入交给主进程，不进入状态事件或 renderer 持久化；stored 模式由 pi auth store 管理，session 模式只保留在当前主进程内存中。

## 会话与队列

- pi session 文件是对话历史和分支树的唯一事实来源，存放在 pi 的 session 目录。
- `activeSessionFile` 由 pi `get_state` 返回，JSONL 导出只允许复制该目录内已校验的当前文件。
- steer/follow-up 队列只保存当前 GUI 已提交内容的投影；pi RPC 只提供计数，`agent_settled` 后清空投影。
- fork 使用 pi 返回的用户消息 `entryId`，clone 使用当前 leaf；GUI 不自行生成会话分支关系。

## Workspace 与审批

```typescript
interface WorkspaceApproval {
  id: string;
  type: string;
  summary: string;
}
```

- approval `id` 由主进程生成且一次性使用；未知或重放 id 必须失败。
- Workspace Git 状态中的 `worktrees` 为 `{ path, head, branch }[]`。
- 持续终端由主进程持有 `cmd.exe` 子进程，renderer 只接收运行状态与输出事件。
- pi tool permission request 使用 extension UI request id；renderer 的选择不能替换原始工具名、路径或命令。

## 持久化归属

| 数据 | 位置 | 说明 |
|---|---|---|
| pi 会话历史与分支 | pi session 目录中的 JSONL | 唯一事实来源 |
| pi 认证凭据 | pi `ModelRuntime` 管理的 runtime / credential store | renderer 不读取正文 |
| 当前项目与 Provider 偏好 | renderer `localStorage` | 仅非敏感选择 |
| `cagent_conversations` | 旧版前端本地缓存 | 当前 `App` 不把它作为 pi 会话来源 |
| 前端构建产物 | `client/dist/` | `npm run build` 生成 |
| Electron 目录版 | `release/win-unpacked/` | `npm run package` 生成，必须经桌面快捷方式验收 |

## 资源模型

资源清单来自 pi `DefaultResourceLoader`、运行期 `get_commands` 和 diagnostics。GUI 只读展示真实 scope、路径、状态与错误；资源打开必须经过 realpath 白名单。pi 0.81.1 没有 built-in MCP，因此不存在可持久化的 MCP connection 模型。
