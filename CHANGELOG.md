# 变更日志

## 2026-07-25

### Cagent 桌面界面中文化

- 将聊天主界面、会话与设置侧栏、运行状态栏、Agent 控制台、工作区、Git、终端、资源中心、用量统计、权限弹窗和 Electron 加载失败页的应用自有文案改为简体中文。
- 保留 Cagent、pi、Provider、Model、OAuth、API Key、MCP、Git、HTML、JSONL、Worktree 等技术名词以及用户内容、模型输出和命令输出原文。
- 中文化仅调整显示层，不改动 IPC type、payload、运行时枚举和 pi RPC 协议。
- 将 Electron 原生菜单改为“应用 / 编辑 / 视图 / 窗口”中文菜单，保留撤销、复制粘贴、缩放、全屏等桌面常用操作。
- 补齐 pi RPC 未运行、超时、退出、会话不可用及身份验证取消等会进入 GUI 的应用自有错误文案。
- 将空会话缺少名称和首条消息时的侧栏回退名称改为“新会话”。
- 验证通过 `npm run build`、`node --check electron/main.cjs`、`git diff --check` 和 `npm run package`；桌面快捷方式仍直接指向当前仓库的 `release/win-unpacked/Cagent.exe`，并已从该快捷方式真实启动检查中文界面。

### 问题

- 原工作台、资源、Usage 和 Agent 控制同时占用聊天流顶部，桌面空间不足且表单密集。
- Workspace 的危险操作审批与凭据清除交互不一致，存在浏览器原生确认框。
- `session:ready -> auth:providers -> initializeRendererSession -> session:ready` 形成 IPC 回环，导致桌面主进程持续满载并占用超过 1 GB 私有内存。
- 桌面快捷方式通过长期驻留的 PowerShell 启动脚本运行 Cagent，产生额外的 PowerShell/conhost 控制台宿主。

### 改动

- 重构为 activity rail、会话/设置导航、主聊天区与按标签切换的 Inspector。
- 将 Files、Git、Terminal、Resources、Usage 收入 Inspector；窄窗口下 Inspector 可关闭为抽屉。
- 增加运行状态轨道与 Agent 控制抽屉，保留 pi session、权限、资源、Git/worktree 与持续终端操作。
- 凭据清除改为受控 modal；恢复会话删除回调的受控确认 UI，并使 Provider 选择同步父级运行时请求状态。
- 恢复 760px 以下的导航抽屉和紧凑布局；最小窗口默认显示聊天主区，Inspector 按需从右侧打开。
- 修正桌面快捷方式启动脚本的工作目录，避免 pi 会话和文件树误以 `release/win-unpacked` 为项目根目录。
- 终端 Start/Kill 操作完成后立即同步运行状态，避免已启动终端仍显示 idle。
- 将“桌面快捷方式是最终验收入口、桌面改动必须重新打包同步”固化为 `AGENTS.md` 协作门槛。
- 校准 README、架构、业务与运维文档：桌面主链路改为 Electron IPC + pi RPC，并修正 Provider/OAuth/凭据移除、MCP unsupported、遗留 WebSocket 未接线边界和开发启动说明。
- 重写编码损坏且过期的数据模型文档，明确 pi session、IPC、Provider 状态、审批和持久化归属。
- 切断初始化回环：renderer 不再在 `session:ready` 后重复查询 Provider；主进程的 `auth:providers` 只发布列表，不再重入完整会话初始化，并增加边界回归 fixture。
- 桌面快捷方式改为直接启动 `Cagent.exe`；兼容启动脚本不再清理端口、杀进程或等待应用退出，避免额外控制台窗口。

### 验证

- 已通过前端与 server 构建、`npm run package`、Auth/权限/资源边界 fixture、pi RPC smoke（12 条命令）、Electron 主进程语法检查和 `git diff --check`。
- 已核对桌面快捷方式链路，并确认启动进程来自 `D:\Cagent\release\win-unpacked\Cagent.exe`，默认项目根目录为 `D:\Cagent`。
- 已在快捷方式启动的真实桌面窗口发送“只回复 CAGENT_CHAT_OK”，收到完整回复 `CAGENT_CHAT_OK`。
- 已在 GUI 启动持续终端，执行 `echo CAGENT_DESKTOP_OK`，完成审批后看到对应输出。
- 已检查 1200x800 和 680x400 最小逻辑窗口；本机 125% 缩放下最小窗口截图为 850x500 物理像素，聊天主区、输入、运行状态和抽屉入口无重叠或水平溢出。
- Python 在本机不可用，因此未运行 `junjie-project-guide` 的 `audit_docs.py`；Markdown 链接与文档归属改为人工核对。
- 已将长期文档与 `electron/main.cjs`、`electron/preload.cjs`、`package.json` 和桌面快捷方式目标逐项人工对照。
- 初始化边界 fixture、前端与 server 构建、Electron 主进程语法检查、Auth/权限/资源 fixture、pi RPC smoke（12 条命令）、`npm run package` 和 `git diff --check` 均通过。
- 从桌面快捷方式启动新版后连续采样 40 秒：主进程私有内存由 185 MB 回落至 134 MB，CPU 仅增加 1.23 秒；运行数分钟并完成一次真实 prompt/模型重试后，主进程私有内存约 128 MB，整个 Cagent 进程组约 328 MB，未再出现修复前 1.2-1.55 GB 的主进程增长。
- 桌面窗口正常显示项目、Provider `Ready`、会话和文件树，真实 prompt 已通过 GUI/IPC 到达 pi 并触发模型请求；本次上游 Provider 返回 `Connection error`，因此未取得完整模型回复。
- 已重建桌面快捷方式并由 Windows Explorer 模拟真实双击启动；进程链为 `Cagent.exe -> explorer.exe -> svchost.exe`，控制台祖先进程数量为 0，未出现 `cmd.exe`、`powershell.exe` 或 `pwsh.exe`，窗口正常显示 `Ready`。

### 影响范围

- 影响 `client/` 初始化订阅、Electron 主进程 Provider 查询路由、桌面资源占用、桌面启动脚本和文档体系。主目录 release 与桌面快捷方式验收均已同步完成。
