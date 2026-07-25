# Cagent

Cagent 是基于 pi coding-agent SDK 的桌面编程 Agent。它把 pi 的对话、会话、模型与凭据、工具审批、资源、项目文件、Git 和终端能力集中到 Electron GUI 中，日常使用无需打开 pi 的终端界面。

## 快速开始

### 前置条件

- Windows 10/11
- Node.js 22 或更高版本
- npm
- 至少一个 pi 支持的 Provider 凭据

### 安装依赖

```powershell
npm run install:all
```

### 开发运行

先启动 Vite：

```powershell
npm run dev:client
```

再开一个终端启动 Electron：

```powershell
npm run dev:electron
```

`server/` 是未接入当前 GUI 的旧版 WebSocket 实现。`npm run dev:server` 只能启动遗留 server，不能代替或连接当前桌面应用。

### 构建与桌面验收

```powershell
npm run package
```

打包产物位于 `release/win-unpacked/Cagent.exe`。本项目以桌面快捷方式启动的应用为最终验收入口：改动 `client/`、`electron/`、IPC、pi RPC 或打包配置后，必须重新打包并从 `C:\Users\28584\Desktop\Cagent.lnk` 启动验证。仅在浏览器或 Vite 页面看到变化不算桌面版完成。

## 当前能力

- pi 会话：新建、切换、fork、clone、steer、follow-up、thinking level、自动/手动 compact
- 模型与认证：Provider 状态、模型选择、API Key、pi 支持范围内的 OAuth 登录和凭据移除
- 对话体验：流式正文、thinking、工具调用状态、图片输入、slash command
- 资源中心：Skills、prompt templates、extensions、commands inventory，以及 HTML/JSONL 导出
- 项目工作台：项目选择、文件树与预览、Git status/stage/commit/branch/worktree、持续终端
- 安全边界：工作区路径限制、Git/终端审批、pi `read/write/edit/bash` 工具权限闸门
- 使用信息：当前会话统计与 usage 展示

pi `0.81.1` 没有 built-in MCP 或 MCP RPC，因此 GUI 会明确显示“不支持”，不会伪造 MCP 连接或工具列表。

## 架构摘要

```text
React renderer
  -> Electron contextBridge / IPC
  -> Electron 主进程
  -> pi JSON Lines RPC 子进程
  -> AI Provider
```

生产桌面版加载 `client/dist/`。`server/` 和 `electron/server.cjs` 仅保留为未接线的遗留源码，不承载新增桌面功能。

## 常用命令

| 命令 | 用途 |
|---|---|
| `npm run install:all` | 安装根目录、client 和 server 依赖 |
| `npm run dev:client` | 启动 Vite，端口 5173 |
| `npm run dev:electron` | 启动开发版 Electron |
| `npm run dev:server` | 单独启动未接入 GUI 的遗留 WebSocket server，端口 4120 |
| `npm run build` | 构建 React 前端 |
| `npm run package` | 构建前端并生成 Electron 目录版 |

## 文档导航

| 文档 | 内容 | 适用场景 |
|---|---|---|
| [AGENTS.md](./AGENTS.md) | 仓库地图、协作约束、桌面验收门槛 | AI 协作 / 新成员入门 |
| [docs/arch.md](./docs/arch.md) | Electron IPC、pi RPC、工作台和权限边界 | 改代码前 |
| [docs/business-rules.md](./docs/business-rules.md) | 认证、会话、工具、资源和错误规则 | 改业务逻辑前 |
| [docs/data-model.md](./docs/data-model.md) | 消息、前端状态与持久化结构 | 改数据逻辑前 |
| [docs/devops.md](./docs/devops.md) | 开发、打包、快捷方式验收和已知问题 | 运行 / 发布时 |
| [CHANGELOG.md](./CHANGELOG.md) | 按日期记录问题、改动、验证和影响范围 | 查历史变更 |
