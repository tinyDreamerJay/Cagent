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

- 点击"新建会话" → 清空消息列表和输入框
- 不会在服务端创建新 SessionManager（复用同一个）

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

## 错误处理

### 错误类型

| 来源 | 处理方式 |
|------|----------|
| 网络断开 | 自动重连（2 秒后） |
| 服务端错误 | WebSocket `error` 消息 → 红色消息气泡 |
| 初始化失败 | 前端显示"初始化失败"，阻塞输入 |
| 无可用模型 | 前端显示"没有可用模型，请检查 API Key" |
| 用户中止 | 不显示错误，恢复输入状态 |

### 约束

- 所有 error payload 必须是 `{ message: string }` 格式
- 前端兼容字符串 payload（向下兼容旧版）
- `sending` 和 `streaming` 状态在出错时必须重置为 `false`
