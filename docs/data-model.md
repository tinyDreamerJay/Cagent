# 数据模型

## 会话与消息

`Message` 是渲染器的展示模型，不是 pi 持久化日志的替代品：

```ts
interface Message {
  id: string;
  role: "user" | "assistant" | "error";
  text: string;
  toolCalls?: ToolCall[];
}
interface ToolCall {
  id: string;
  name: string;
  params: string;
  result?: string;
  status?: "running" | "done" | "error";
  collapsed: boolean;
}
```

会话列表、消息、分支和当前 leaf 均来自 pi `SessionManager`/RPC；前端不得自行伪造历史记录。

## RPC 包络

Electron preload 暴露 `window.cagent.pi.send(type, payload)` 与 `subscribe(type, handler)`。主进程把请求映射到 pi JSONL RPC，并将结果转成稳定的 GUI 事件。错误统一为 `{ message: string }`。

常用请求包括：`session:prompt`、`session:abort`、`session:new`、`session:list`、`session:switch`、`session:stats`、`session:compact`、`session:set-thinking`、`session:set-auto-compaction`、`session:commands`、`session:export-html`，以及资源中心使用的 `resource:list`、`resource:reload`、`resource:open`（仅在 pi 实际支持时发送）。

## 资源模型

```ts
type ResourceKind = "skill" | "prompt" | "extension" | "command";
interface PiResource {
  kind: ResourceKind;
  name: string;
  source: string;       // builtin、user、project、extension 等 pi 返回值
  path?: string;
  enabled?: boolean;
  status: "loaded" | "disabled" | "error" | "unknown";
  error?: string;
  reloadable?: boolean;
}
```

资源状态、来源和路径必须直接显示 pi 返回值。GUI 只能对 pi 暴露的 reload、启停或打开位置能力提供入口；TUI 专属操作不能被模拟成成功。

## 使用统计

`session:stats` 返回 pi 的原始字段，前端映射为可读仪表：输入/输出 token、cache read/write token、估算 cost、context 使用量/窗口、compaction 次数与最近一次时间。未知字段保留在 `raw`，不得把缺失值渲染为 0 或伪造价格。

## 导入、导出与分享

导出格式：HTML（可读报告）和 JSONL（逐条 pi 事件/日志记录）。导入只恢复 pi 支持的会话数据，失败时逐条报告，不覆盖当前会话。分享前必须扫描 API key、authorization header、环境变量、绝对本地路径和工具输出中的疑似凭据；扫描结果为 `safe`、`blocked` 或 `needs-review`，阻止状态不得一键分享。
