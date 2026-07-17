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
| [README.md](../README.md) | 项目概述、快速开始、技术栈 | 所有人 |
| [docs/arch.md](./arch.md) | 架构约定：三层结构、WebSocket 协议、数据流 | 改代码前必读 |
| [docs/business-rules.md](./business-rules.md) | 业务约束：API Key 管理、会话流程、工具执行、错误处理 | 改业务逻辑前必读 |
| [docs/data-model.md](./data-model.md) | 数据模型：WebSocket 消息类型、前端状态、会话结构 | 改数据逻辑前 |
| [docs/devops.md](./devops.md) | 工程规范：开发流程、构建打包、已知问题 | 部署/打包时读 |

## 版本

当前版本：`1.0.0`

## 协作原则

> 本项目包含三个独立部分（client、server、electron），改动其中一部分时需要确认对另外两部分的影响。尤其是 electron/server.cjs 与 server/src/ 功能重复，修改一端应同步更新另一端。
