# 业务规则

## API Key

API Key 仅用于主进程向 pi 注入运行时凭据；渲染器不得将密钥发送到第三方服务。当前支持的 provider 以 pi 返回的 provider 列表为准。密钥缺失或初始化失败时，禁止提交 prompt，并展示可操作错误。

## 会话

会话创建、切换、fork、clone、删除和历史加载均调用 pi RPC。正在生成时只允许 pi 明确支持的 `steer`/`follow-up`/`abort`；GUI 队列只是提交记录，不能删除或重排 pi 内部队列。`compact`、thinking level 和自动压缩开关必须显示真实执行状态。

## 资源中心

资源中心展示 skills、prompt templates、extensions、commands 的名称、来源、路径、状态和错误。资源发现失败必须保留错误并允许重试。启用/禁用、reload、打开位置只有在 pi 0.81.1 RPC/TUI 实际提供对应能力时才启用按钮；否则显示只读状态和原因。不得通过修改配置文件或前端状态伪造资源已生效。

## 统计与费用

统计来自 `get_session_stats`。仪表优先展示 token、缓存命中、context 占用、compaction 和 cost；模型未提供价格时 cost 显示“未知”，不能按猜测单价计算。刷新失败不清空上一次有效数据，应标记过期。

## 导入导出与分享

HTML 导出供阅读，JSONL 导出供恢复/审计。导入前校验版本、JSONL 行格式和会话归属；写入失败不得破坏当前会话。分享检查必须遮蔽 API key、token、cookie、authorization、私钥及敏感环境变量，并提示绝对路径可能泄露工作区信息。阻断项未确认前不可生成分享文件。

## 错误处理

所有 RPC 错误转为 `{ message: string }`，同时保留资源/导入的结构化错误上下文。网络或 pi 子进程断开时拒绝未完成请求、恢复输入状态，不把 `EPIPE` 当作成功。用户主动 abort 不显示为错误。
