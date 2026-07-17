# Cagent

一个极简的编程 Agent，界面干净、专注。基于 pi 的 Agent SDK 构建。

## 项目结构

```
Cagent/
├── server/          # Node.js + Express + WebSocket + pi SDK
│   └── src/
│       ├── index.ts      # Server entry, WebSocket management
│       └── session.ts    # Agent session wrapping pi SDK
├── client/          # React + TypeScript + Vite
│   └── src/
│       ├── App.tsx        # Main chat interface
│       ├── components/
│       │   └── Sidebar.tsx
│       └── hooks/
│           └── useWebSocket.ts
└── package.json
```

## 快速开始

### 前置条件
- Node.js >= 22
- 一个 API 密钥（Anthropic、OpenAI 等）

### 安装

```bash
# 安装所有依赖
npm install
cd server && npm install
cd ../client && npm install
cd ..
```

### 开发

```bash
# 同时启动服务端和客户端
npm run dev
```

也可以分别启动：

```bash
# 终端 1 - 服务端（端口 4120）
cd server && npm run dev

# 终端 2 - 客户端（端口 5173）
cd client && npm run dev
```

### 构建

```bash
cd client && npm run build
```

## 功能特性

- **极简聊天界面** - 干净、无干扰的界面
- **工具执行** - 读取、写入、编辑文件和运行 bash 命令
- **实时流式输出** - 逐 token 流式响应
- **会话管理** - 创建和管理多个会话
- **工具输出展示** - 可折叠的工具调用/结果面板

## 环境变量

启动前设置 API 密钥：

```bash
export ANTHROPIC_API_KEY=sk-ant-...
# 或
export OPENAI_API_KEY=sk-...
```

## 技术栈

- **前端**: React 19, TypeScript, Vite
- **后端**: Express, ws (WebSocket)
- **Agent**: @earendil-works/pi-coding-agent SDK
- **设计**: 自定义极简 CSS（无 UI 框架）

## 更多文档

| 文档 | 内容 | 适用场景 |
|------|------|----------|
| [AGENTS.md](./AGENTS.md) | 项目索引、目录结构、协作原则 | AI 协作 / 新成员入门 |
| [docs/arch.md](./docs/arch.md) | 架构约定：三层结构、WebSocket 协议、组件树 | 改代码前 |
| [docs/business-rules.md](./docs/business-rules.md) | 业务约束：API Key 流程、会话管理、错误处理 | 改业务逻辑前 |
| [docs/data-model.md](./docs/data-model.md) | 数据模型：消息类型、前端状态、WebSocket 格式 | 改数据逻辑前 |
| [docs/devops.md](./docs/devops.md) | 工程规范：开发流程、构建打包、已知问题 | 部署/打包时 |
