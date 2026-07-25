# 变更日志

## 2026-07-25

### 问题

- 原工作台、资源、Usage 和 Agent 控制同时占用聊天流顶部，桌面空间不足且表单密集。
- Workspace 的危险操作审批与凭据清除交互不一致，存在浏览器原生确认框。

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

### 验证

- 已通过前端与 server 构建、`npm run package`、Auth/权限/资源边界 fixture、pi RPC smoke（12 条命令）、Electron 主进程语法检查和 `git diff --check`。
- 已核对桌面快捷方式链路，并确认启动进程来自 `D:\Cagent\release\win-unpacked\Cagent.exe`，默认项目根目录为 `D:\Cagent`。
- 已在快捷方式启动的真实桌面窗口发送“只回复 CAGENT_CHAT_OK”，收到完整回复 `CAGENT_CHAT_OK`。
- 已在 GUI 启动持续终端，执行 `echo CAGENT_DESKTOP_OK`，完成审批后看到对应输出。
- 已检查 1200x800 和 680x400 最小逻辑窗口；本机 125% 缩放下最小窗口截图为 850x500 物理像素，聊天主区、输入、运行状态和抽屉入口无重叠或水平溢出。
- Python 在本机不可用，因此未运行 `junjie-project-guide` 的 `audit_docs.py`；Markdown 链接与文档归属改为人工核对。
- 已将长期文档与 `electron/main.cjs`、`electron/preload.cjs`、`package.json` 和桌面快捷方式目标逐项人工对照。

### 影响范围

- 影响 `client/` 的 React 组件与样式、桌面启动脚本和文档体系；未改动 Electron 主进程业务逻辑。主目录 release 与桌面快捷方式验收均已同步完成。
