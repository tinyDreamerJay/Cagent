# Cagent — 项目索引

## 项目定位

基于 pi coding-agent SDK 的桌面端编程 Agent。Electron 壳 + React 前端 + Electron IPC + pi JSON Lines RPC 驱动。
目标是让用户以桌面应用的方式使用 pi，无需终端。

## 目录结构

| 路径 | 说明 |
|------|------|
| `client/` | React 19 + TypeScript + Vite 前端（聊天、导航、Inspector、Agent 控制） |
| `server/` | 未接入当前 GUI 的旧版 Express + WebSocket 实现，仅供历史源码对照 |
| `electron/` | Electron 桌面壳（窗口、IPC、pi RPC、工作台与权限） |
| `electron/main.cjs` | Electron 主进程（窗口、pi RPC 子进程、认证与工作台） |
| `electron/preload.cjs` | 预加载脚本（暴露平台信息到渲染进程） |
| `electron/server.cjs` | 未被当前 Electron 主进程启动的旧版内嵌 server |
| `release/` | electron-builder 构建输出（Cagent.exe） |
| `docs/` | 本文档体系 |

## 文档体系

| 文档 | 内容 | 谁该读 |
|------|------|--------|
| [README.md](./README.md) | 项目概述、快速开始、技术栈 | 所有人 |
| [docs/arch.md](./docs/arch.md) | 架构约定：Electron IPC、pi RPC、工作台与权限 | 改代码前必读 |
| [docs/business-rules.md](./docs/business-rules.md) | 业务约束：API Key 管理、会话流程、工具执行、错误处理 | 改业务逻辑前必读 |
| [docs/data-model.md](./docs/data-model.md) | 数据模型：IPC 事件、前端状态、pi 会话与持久化归属 | 改数据逻辑前 |
| [docs/devops.md](./docs/devops.md) | 工程规范：开发流程、构建打包、已知问题 | 部署/打包时读 |
| [CHANGELOG.md](./CHANGELOG.md) | 按日期记录问题、改动、验证与影响范围 | 每次实质改动后更新 |

## 协作原则

> 当前桌面唯一运行链路是 `client -> Electron IPC -> pi RPC`。`server/` 与 `electron/server.cjs` 没有接入当前 GUI，只保留为遗留源码；新增 pi 或 GUI 能力应实现到主链路，不要为了形式同步到旧 server。只有明确维护遗留实现时，才需要同步检查这两个旧文件集。

## 桌面端同步与验收

- 本项目的最终用户入口是桌面快捷方式启动的 Electron 应用。浏览器开发版、Vite 页面或单独构建成功只能作为中间检查，不能作为最终验收结论。
- 修改 `client/`、`electron/`、桌面 IPC、pi RPC 主链路或打包配置后，必须运行 `npm run package`，确认改动进入 `release/win-unpacked/`。
- 打包后必须核对桌面快捷方式及其启动脚本仍指向当前仓库的 `release/win-unpacked/Cagent.exe`，再从该快捷方式真实启动应用。
- 桌面验收至少覆盖：窗口能显示新版界面、项目选择、发送真实消息、流式回复、工具/权限交互，以及本次修改直接影响的功能。涉及响应式布局时同时检查窄窗口和常用桌面窗口尺寸。
- 截图只能作为可视证据，不能替代交互验证；不得用旧进程、旧 release 目录或开发服务器截图宣称桌面版已经更新。
- 如果桌面打包或快捷方式验收没有完成，交付说明必须明确标为“尚未完成桌面验收”，不能只说“已完成”或“已跑通”。
