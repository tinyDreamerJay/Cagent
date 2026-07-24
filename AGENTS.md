# Cagent — 项目索引

## 项目定位

基于 pi coding-agent SDK 的极简桌面端编程 Agent。Electron 壳 + React 前端 + WebSocket 通信 + pi SDK 驱动。
目标是让用户以桌面应用的方式使用 pi，无需终端。

## 目录结构

| 路径 | 说明 |
|------|------|
| `client/` | React 19 + TypeScript + Vite 前端（聊天界面、侧边栏、WebSocket hook） |
| `server/` | Express + WebSocket 后端（pi SDK 集成、会话管理） |
| `electron/` | Electron 桌面壳（窗口管理、内嵌 server、IPC） |
| `electron/main.cjs` | Electron 主进程（窗口创建、server 子进程管理） |
| `electron/preload.cjs` | 预加载脚本（暴露平台信息到渲染进程） |
| `electron/server.cjs` | Electron 内嵌 server（打包后的后端，CJS 格式） |
| `release/` | electron-builder 构建输出（Cagent.exe） |
| `docs/` | 本文档体系 |

## 文档体系

| 文档 | 内容 | 谁该读 |
|------|------|--------|
| [README.md](./README.md) | 项目概述、快速开始、技术栈 | 所有人 |
| [docs/arch.md](./docs/arch.md) | 架构约定：三层结构、WebSocket 协议、数据流 | 改代码前必读 |
| [docs/business-rules.md](./docs/business-rules.md) | 业务约束：API Key 管理、会话流程、工具执行、错误处理 | 改业务逻辑前必读 |
| [docs/data-model.md](./docs/data-model.md) | 数据模型：WebSocket 消息类型、前端状态、会话结构 | 改数据逻辑前 |
| [docs/devops.md](./docs/devops.md) | 工程规范：开发流程、构建打包、已知问题 | 部署/打包时读 |
| [CHANGELOG.md](./CHANGELOG.md) | 按日期记录问题、改动、验证与影响范围 | 每次实质改动后更新 |

## 版本

当前版本：`1.0.0`

## 协作原则

> 本项目包含三个独立部分（client、server、electron），改动其中一部分时需要确认对另外两部分的影响。尤其是 electron/server.cjs 与 server/src/ 功能重复，修改一端应同步更新另一端。

## 桌面端同步与验收

- 本项目的最终用户入口是桌面快捷方式启动的 Electron 应用。浏览器开发版、Vite 页面或单独构建成功只能作为中间检查，不能作为最终验收结论。
- 修改 `client/`、`electron/`、桌面 IPC、pi RPC 主链路或打包配置后，必须运行 `npm run package`，确认改动进入 `release/win-unpacked/`。
- 打包后必须核对桌面快捷方式及其启动脚本仍指向当前仓库的 `release/win-unpacked/Cagent.exe`，再从该快捷方式真实启动应用。
- 桌面验收至少覆盖：窗口能显示新版界面、项目选择、发送真实消息、流式回复、工具/权限交互，以及本次修改直接影响的功能。涉及响应式布局时同时检查窄窗口和常用桌面窗口尺寸。
- 截图只能作为可视证据，不能替代交互验证；不得用旧进程、旧 release 目录或开发服务器截图宣称桌面版已经更新。
- 如果桌面打包或快捷方式验收没有完成，交付说明必须明确标为“尚未完成桌面验收”，不能只说“已完成”或“已跑通”。
