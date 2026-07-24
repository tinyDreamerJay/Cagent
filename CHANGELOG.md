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

### 验证

- 已通过 `npm run build` 与 `npm run package`；新版已写入本 worktree 的 `release/win-unpacked/Cagent.exe`。
- 已完成真实 Electron 窗口检查：1200x800 截图确认 Inspector 抽屉完整可见；680x400 为 Electron 主进程的最小逻辑尺寸，本机 125% 缩放下以 850x500 物理像素完整截图确认关闭按钮和标签无截断。
- 已通过 `git diff --check`。

### 影响范围

- 仅 `client/` 的 React 组件与样式，以及本变更日志；未改动 Electron 主进程业务逻辑。桌面快捷方式仍指向 `D:\Cagent`，需在合并后由主目录重新打包并完成最终快捷方式验收。
