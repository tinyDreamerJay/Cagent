# 业务约束

## 界面语言

- Cagent 桌面应用默认使用简体中文，用户可见的按钮、标签、状态、提示、空状态、确认弹窗和应用自有错误页均使用中文。
- 产品名、Provider、Model、OAuth、API Key、MCP、Git、HTML、JSONL、命令、代码标识符和文件路径保留原文，不强行翻译。
- 用户输入、模型回复、命令输出、文件内容、资源名称及上游服务返回的原始错误不得擅自翻译或改写。
- 内部 IPC type、payload 字段和枚举值保持稳定；界面中文化只能改变显示文案，不能改变通信协议。

## API Key 管理

## 工作台权限

- 文件读取仅允许当前工作目录边界内的路径，超出边界直接拒绝。
- 终端、Git 暂存、提交和创建分支属于危险操作，默认不执行，必须由用户在审批框中确认。
- 终端输出通过主进程事件流回传；renderer 不能创建子进程或调用文件系统。

## Agent 工具权限

- 权限闸门覆盖 pi 自身的 `read`、`write`、`edit`、`bash` 工具，不仅覆盖工作台按钮。
- 工作区外路径默认 `block`；写入/编辑默认 `ask`；提权、破坏性、网络和安装命令默认 `ask`，无 GUI 时 `block`。
- 用户选择仅对当前一次 tool call 生效，不保存为永久授权。策略可用 `CAGENT_PERMISSION_POLICY` 按工具或风险类别配置 `ask`、`allow`、`block`。

### 设置流程

1. GUI 从 pi runtime 读取 Provider、认证能力、凭据来源和可用模型。
2. 用户选择 Provider，可使用 API Key；pi 声明支持 OAuth 时也可从 GUI 发起 OAuth。
3. API Key 只作为一次性 IPC payload 交给 Electron 主进程；stored 模式使用 `ModelRuntime.login(provider, "api_key")` 写入 pi auth store，session 模式只保存在主进程内存并注入当前 pi RPC 子进程。两种模式都不写入浏览器 `localStorage`。
4. OAuth 使用 `ModelRuntime.login(provider, "oauth")`，需要用户交互时通过受控 GUI 对话框完成。
5. 移除凭据时调用 pi 的 `logout` 和/或 `removeRuntimeApiKey`，随后重启 pi RPC 并重新发布状态。

### 约束

- renderer 不持久化或回显 API Key；`localStorage` 只保存项目路径、Provider 选择等非敏感偏好
- Provider 列表和模型能力以当前 pi runtime 为准，不能硬编码为 Anthropic
- 凭据会由对应 AI Provider 使用；“本地处理”不等于不会发送给用户选择的 Provider

## Provider/Auth 与 MCP 管理

- renderer 只接收 Provider 的 `configured`、`source`、模型列表、认证能力和错误摘要，不接收 API Key。
- 认证管理使用 pi 0.81.1 `ModelRuntime` 的 `login`、`logout` 和 `removeRuntimeApiKey`；界面只展示 runtime 实际声明的 OAuth 能力。
- pi 0.81.1 明确没有 built-in MCP，也没有 MCP RPC/事件。GUI 只能展示 unsupported 说明，不能通过扫描配置文件伪造连接状态。
- 如果初始化尚未完成就设置 Key，前端将 Key 排队，等 `session:ready` 后自动发送
- 当前 Provider 没有可用凭据或模型时，输入框禁用，无法发送消息

## 会话流程

### 初始化

1. Electron renderer 通过 preload IPC bridge 发送 `session:init`
2. Electron 主进程启动 pi JSON Lines RPC 子进程并创建认证 runtime
3. 主进程转发 `session:ready`、Provider 状态、模型和持久化会话
4. 用户选择已有凭据或在 Settings 中登录

### 对话

1. 用户输入文本 → 按 Enter 发送
2. 前端发送 `session:prompt`，同时显示用户消息气泡
3. Electron 主进程向 pi RPC 发送 `prompt`
4. 主进程把 pi `message_update` 映射为 `token` → 前端实时更新助手消息
5. 如果有工具调用 → `tool:call` + `tool:result`
6. 完成后 → `message:done`

### 中止

- 发送中点击按钮 → `session:abort`
- Electron 主进程向 pi RPC 发送 `abort`
- pi settle 后主进程统一返回 `message:done`；当前主链路不单独发送 `message:aborted`

### 新建会话

- 点击"新建会话" → 前端清空展示消息并发送 `session:new`
- Electron 主进程调用 pi `new_session`，由 pi 创建新的持久化会话上下文，再把新的 `session:state` 返回给前端
- 侧边栏会话列表直接由 pi `SessionManager.list(currentCwd)` 读取；会话文件与 pi 上下文是唯一事实来源，不使用浏览器本地会话伪造历史
- 选择侧边栏会话时，主进程只允许切换当前项目列表中的文件，再调用 pi `switch_session` 和 `get_messages` 重新加载历史
- 归档会话不删除 JSONL：主进程只允许归档当前项目 `SessionManager.list(currentCwd)` 返回的文件，并移动到同一项目会话目录的 `.cagent-archive/` 子目录。
- 归档活动会话前必须先预检目标，再让 pi 切换到新会话，避免移动仍在写入的文件；移动成功或失败后都要重新同步 renderer。已归档会话可恢复到原项目会话目录，归档和恢复均禁止覆盖同名文件，并拒绝通过 junction/symlink 将归档目录指向项目会话目录外。

### 运行控制

- 思考等级、自动压缩和手动压缩均通过 Electron 主进程调用 pi RPC；前端不得自行模拟这些状态
- 模型选择必须使用 `(Provider, Model)` 联合标识立即调用 pi `set_model`，不得按 Model ID 反推 Provider，也不得在会话初始化时把 renderer 的旧选择自动写回 pi；思考强度选择调用 `set_thinking_level`，并以当前会话的状态或 `thinking_level_change` 记录恢复显示状态。
- `Compact` 会压缩当前 pi 会话上下文，避免长对话占满模型上下文；执行期间显示运行状态
- 发送中禁用运行控制，避免在 pi 正在生成时切换会话状态
- 发送中输入框仍可用于提交 `steer` 或 `follow-up`：前者交给 pi 立即插入，后者等待当前轮次完成。队列面板仅是当前 GUI 已提交消息的只读投影，不能删除或重排 pi 内部队列。
- Fork 必须由 pi 返回的用户消息 `entryId` 发起；Clone 仅在当前 session 存在 leaf entry 时可用。
- GUI 不再提供独立用量面板；输入框左下角只显示 `100 - contextUsage.percent` 得到的上下文剩余百分比。pi 尚未返回可信用量时显示 `--`，不得伪造数值。

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
| renderer bridge 不可用 | 显示桌面连接不可用并阻塞输入 |
| 主进程错误 | IPC `error` 事件 → 错误消息气泡 |
| 初始化失败 | 前端显示"初始化失败"，阻塞输入 |
| 无可用模型 | 前端显示"没有可用模型，请检查 API Key" |
| 模型网关失败 | pi `agent_end` 的错误消息转为 GUI `error` 事件，并恢复输入状态 |
| pi RPC 管道断开 | 主进程拒绝未完成请求并显示错误；不得因 `EPIPE` 退出 |
| 用户中止 | 不显示错误，恢复输入状态 |

### 约束

- 所有 error payload 必须是 `{ message: string }` 格式
- 前端兼容字符串 payload（向下兼容旧版）
- `sending` 和 `streaming` 状态在出错时必须重置为 `false`
## 资源中心与导出增量规则

资源只读；Refresh inventory 重新扫描，Open location 受 realpath 白名单限制。HTML 使用 pi `export_html`，JSONL 使用当前 session 原文件并经保存对话框复制；pi 不支持导入时不提供 Import。
