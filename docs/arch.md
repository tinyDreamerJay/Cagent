# 架构约定

## 主链路

```
React renderer
  -> preload IPC (send/subscribe)
Electron main process
  -> JSONL stdin/stdout RPC
pi 0.81.1 runtime
  -> sessions, resources, tools, extensions, models
```

`server/src` 与 `electron/server.cjs` 仅作为旧 WebSocket 兼容实现，不新增主链路能力。涉及 pi 能力时优先在 `electron/main.cjs` 增加薄 RPC 适配，再由独立 React 组件消费。

## 组件边界

`ResourceCenter` 负责资源列表、状态、错误和允许的动作；`UsagePanel` 负责统计可读化；导入导出面板负责文件选择、格式校验和敏感信息检查。避免把这些逻辑堆回 `App.tsx`。

## RPC 适配原则

主进程维护 pi 命令名与 payload 的映射，处理超时、断管和错误转换。资源 reload、enable/disable、open location 等动作必须先检查 pi 0.81.1 是否暴露；TUI-only API 不可假装存在。未知 pi 事件通过 `pi:event` 转发并在前端安全降级。

## 数据流与持久化

会话文件和资源发现路径由 pi 决定。渲染器只保存展示状态和用户偏好，不写 pi 会话日志。导出文件由主进程写入用户选择的位置；导入由主进程解析后交给 pi，避免 renderer 直接访问文件系统。

## 安全边界

API Key、环境变量和文件系统访问留在主进程。分享前扫描在主进程执行并返回脱敏预览/阻断原因。任何资源路径打开操作都需由主进程校验并调用系统打开器。
