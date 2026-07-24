# 业务约束

## API Key 管理

### 设置流程

1. 用户在侧边栏输入 API Key（支持 `sk-ant-...` 格式）
2. 前端保存到 `localStorage`（key: `cagent_apikey`）
3. 前端发送 `auth:set-key` → 服务端调用 `modelRuntime.setRuntimeApiKey("anthropic", key)`
4. 服务端调用 `getAvailable("anthropic")` 刷新模型列表
5. 服务端返回 `auth:key-ready` → 前端显示"就绪"状态

### 约束

- API Key 仅在本地存储，不上传到任何第三方
- 目前只支持 Anthropic provider（`"anthropic"`）

## Provider/Auth 与 MCP 管理

- renderer 只接收 provider 的 `configured`、`source`、模型列表和错误摘要，不接收 API Key；密钥由 pi runtime 保留在服务端内存/既有 credential store 中。
- `auth:set-key` 使用 pi 0.81.1 的 `ModelRuntime.setRuntimeApiKey`。该版本未导出 `clearRuntimeApiKey` 或 OAuth RPC，因此界面会明确报告清除/OAuth 不可用，不伪造成功状态。
- MCP 仅发现 `~/.pi/agent/mcp.json` 或 `settings.json` 中的配置并展示来源；pi 0.81.1 未导出 MCP reconnect/list RPC，刷新操作只重新读取配置并标记能力边界。
- 如果初始化尚未完成就设置 Key，前端将 Key 排队，等 `session:ready` 后自动发送
- 没有 API Key 时，输入框禁用，无法发送消息

## 会话流程

### 初始化

1. 前端连接 WebSocket → 自动发送 `session:init`
2. 服务端加载 pi SDK、创建 SessionManager 和 ModelRuntime
3. 服务端返回 `session:ready`
4. 前端发送已保存的 API Key（如有）

### 对话

1. 用户输入文本 → 按 Enter 发送
2. 前端发送 `session:prompt`，同时显示用户消息气泡
3. 服务端创建 AgentSession，调用 `session.prompt()`
4. 服务端流式推送 `token` → 前端实时更新助手消息
5. 如果有工具调用 → `tool:call` + `tool:result`
6. 完成后 → `message:done`

### 中止

- 发送中点击按钮 → `session:abort`
- 服务端调用 `AbortController.abort()`
- 返回 `message:aborted`

### 新建会话

- 点击"新建会话" → 前端清空展示消息并发送 `session:new`
- Electron 主进程调用 pi `new_session`，由 pi 创建新的持久化会话上下文，再把新的 `session:state` 返回给前端
- 侧边栏会话列表直接由 pi `SessionManager.list(currentCwd)` 读取；会话文件与 pi 上下文是唯一事实来源，不使用浏览器本地会话伪造历史
- 选择侧边栏会话时，主进程只允许切换当前项目列表中的文件，再调用 pi `switch_session` 和 `get_messages` 重新加载历史

### 运行控制

- 思考等级、自动压缩和手动压缩均通过 Electron 主进程调用 pi RPC；前端不得自行模拟这些状态
- `Compact` 会压缩当前 pi 会话上下文，避免长对话占满模型上下文；执行期间显示运行状态
- 发送中禁用运行控制，避免在 pi 正在生成时切换会话状态
- 发送中输入框仍可用于提交 `steer` 或 `follow-up`：前者交给 pi 立即插入，后者等待当前轮次完成。队列面板仅是当前 GUI 已提交消息的只读投影，不能删除或重排 pi 内部队列。
- Fork 必须由 pi 返回的用户消息 `entryId` 发起；Clone 仅在当前 session 存在 leaf entry 时可用。

## 工具执行

pi SDK 自带四个内置工具：

| 工具 | 功能 | 前端展示 |
|------|------|----------|
| `read` | 读取文件 | 蓝色图标 `R` |
| `write` | 写入文件 | 绿色图标 `W` |
| `edit` | 编辑文件 | 黄色图标 `E` |
| `bash` | 执行命令 | 红色图标 `B` |

### 展示规则

- 工具调用默认展开，点击标题可折叠
- 参数和结果分开显示，结果区有分隔线
- 结果超过 8000 字符自动截断（显示 `... [truncated]`）
- 工具块按 `toolCallId` 更新 running、partial output、done/error 状态，不得仅按工具名匹配并发调用。
- Thinking delta 单独折叠显示，不得混入最终 assistant 正文。

## Extension UI

- `setWidget` 仅渲染 RPC 允许的字符串行，位置为输入框上方或下方；传入 `undefined` 时移除对应 key 的 widget。
- `set_editor_text` 覆盖当前输入并聚焦编辑器；它不自动发送 prompt。

## 错误处理

### 错误类型

| 来源 | 处理方式 |
|------|----------|
| 网络断开 | 自动重连（2 秒后） |
| 服务端错误 | WebSocket `error` 消息 → 红色消息气泡 |
| 初始化失败 | 前端显示"初始化失败"，阻塞输入 |
| 无可用模型 | 前端显示"没有可用模型，请检查 API Key" |
| 模型网关失败 | pi `agent_end` 的错误消息转为 GUI `error` 事件，并恢复输入状态 |
| pi RPC 管道断开 | 主进程拒绝未完成请求并显示错误；不得因 `EPIPE` 退出 |
| 用户中止 | 不显示错误，恢复输入状态 |

### 约束

- 所有 error payload 必须是 `{ message: string }` 格式
- 前端兼容字符串 payload（向下兼容旧版）
- `sending` 和 `streaming` 状态在出错时必须重置为 `false`
