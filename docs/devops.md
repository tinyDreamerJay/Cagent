# 工程规范 & 运维

## 开发流程

### 启动桌面开发版

```bash
# 安装所有依赖
npm run install:all

# 终端 1 — Vite（端口 5173）
npm run dev:client

# 终端 2 — Electron（通过 IPC 启动 pi RPC）
npm run dev:electron
```

### 遗留 server 与组合命令

`npm run dev:server` 会启动遗留 WebSocket server，但当前 GUI 没有连接它。当前 `npm run dev` 仍会额外启动这个无关 server，日常桌面开发应使用上面的两个独立命令，避免把遗留日志误当成当前行为。

## 构建打包

### 构建前端

```bash
cd client && npm run build
```

输出在 `client/dist/`。

### 打包 Electron 应用

```bash
npm run build      # 构建前端
npm run package    # electron-builder 打包
```

输出在 `release/win-unpacked/`（Cagent.exe + 依赖文件）。

### 桌面快捷方式验收

桌面端是最终用户入口。修改 `client/`、`electron/`、IPC、pi RPC 或打包配置后，必须重新运行 `npm run package`，然后核对并从 `C:\Users\28584\Desktop\Cagent.lnk` 启动。

当前启动链路为：

```text
C:\Users\28584\Desktop\Cagent.lnk
  -> D:\Cagent\release\win-unpacked\Cagent.exe
```

快捷方式的 `WorkingDirectory` 必须是 `D:\Cagent`；不得使用 `release/win-unpacked` 作为工作目录，否则文件树和 pi 会话会错误地落到发行目录。快捷方式必须直接启动 EXE，不得通过 `cmd.exe` 或 `powershell.exe` 中转，以免弹出或常驻额外控制台窗口。

`launch-cagent.ps1` 仅保留为兼容入口，执行后立即启动 EXE 并退出；桌面快捷方式不再使用它。

最终验收至少确认：主窗口来自上述 EXE、默认项目根目录正确、消息能收到模型回复、工具操作出现审批并可执行，以及 680x400 最小逻辑窗口没有重叠或水平溢出。浏览器/Vite 检查只能作为中间验证。

### 打包配置

`package.json` 中的 `build` 字段：

```json
{
  "appId": "com.cagent.app",
  "productName": "Cagent",
  "files": [
    "electron/*.cjs",
    "client/dist/**/*",
    "node_modules/**/*"
  ],
  "win": {
    "target": "dir",
    "signAndEditExecutable": false
  }
}
```

- `target: "dir"` 仅生成解包目录，不生成 NSIS 安装包。
- `signAndEditExecutable: false` 让目录版不依赖下载 `winCodeSign`；当前发布流程不做 Windows 代码签名或 EXE 资源编辑。
- 因此应用图标以 `electron/icon.svg` 和网页图标为准，Windows EXE 的资源图标不作为发布验证条件。

## 已知问题

### winCodeSign 符号链接错误

```
ERROR: Cannot create symbolic link : 客户端没有所需的特权
```

electron-builder 打包时下载的 winCodeSign 压缩包包含 macOS 符号链接，
Windows 上解压会失败。**不影响 asar 打包**，只是无法生成安装包。

当前对策：使用 `target: "dir"` 和 `signAndEditExecutable: false`，跳过安装包步骤以及对 EXE 的签名/资源编辑。

### Vite base 路径

打包后 Electron 用 `file://` 协议加载页面，**Vite 必须设置 `base: './'`**，
否则 JS/CSS 无法加载（绝对路径在 file:// 下无效）。

### 4120 端口

当前 Electron 主链路不依赖 4120 端口，桌面启动流程也不会清理或占用该端口；端口占用不应被当作 pi RPC 主链路故障的根因。

### 单实例

Electron 使用 single-instance lock；重复点击桌面快捷方式时，第二个实例退出并聚焦现有窗口，不需要启动脚本预先终止旧进程。

## 提交前检查

- 不提交 `.env*`、`node_modules/`、`dist/`、`release/`（`.gitignore` 已配置）
- 新增桌面能力时实现到 Electron IPC + pi RPC 主链路，不要继续扩展旧版 server
- 明确维护遗留 WebSocket 实现时，同时检查 `electron/server.cjs` 与 `server/src/` 的对应逻辑；它们当前未接入 GUI
- 修改前端后运行 `cd client && npm run build` 确保能正常构建
- 构建后的 `vite.config.ts` 中 `base: './'` 不能被误删
- 修改桌面相关代码后运行 `npm run package`，并按“桌面快捷方式验收”从最终入口复测

## 环境变量

| 变量 | 说明 |
|------|------|
| `ANTHROPIC_API_KEY` | Anthropic API 密钥（系统级，应用内也可设置） |
| `OPENAI_API_KEY` | OpenAI API 密钥（备用） |
| `CAGENT_TEST_API_KEY` | 仅供需要真实 provider 的本地测试使用；不得写入脚本、文档或 Git |
| `CAGENT_PERMISSION_POLICY` | Electron/pi 工具权限策略 JSON；未设置时使用默认 ask/allow/block 规则 |
| `CAGENT_DEVTOOLS` | 开发版设为 `1` 时打开 Electron DevTools |
| `PORT` | 仅遗留 WebSocket server 使用，默认 4120；当前桌面主链路不使用 |
