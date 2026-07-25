export interface UsagePanelProps { stats: Record<string, unknown> | null; onRefresh?: () => void; }
const pick = (stats: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = key.split(".").reduce<unknown>((current, part) => (current && typeof current === "object") ? (current as Record<string, unknown>)[part] : undefined, stats);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
};
const number = (value: unknown) => value === undefined || value === null ? "—" : typeof value === "number" ? value.toLocaleString() : String(value);

export function UsagePanel({ stats, onRefresh }: UsagePanelProps) {
  const data = stats || {};
  const metrics: [string, unknown][] = [
    ["输入 Token", pick(data, ["tokens.input"])], ["输出 Token", pick(data, ["tokens.output"])],
    ["缓存读取", pick(data, ["tokens.cacheRead"])], ["缓存写入", pick(data, ["tokens.cacheWrite"])],
    ["费用", pick(data, ["cost"])], ["上下文 Token", pick(data, ["contextUsage.tokens"])],
    ["上下文窗口", pick(data, ["contextUsage.contextWindow"])], ["上下文占比", pick(data, ["contextUsage.percent"])],
    ["用户消息", pick(data, ["userMessages"])], ["助手消息", pick(data, ["assistantMessages"])],
    ["工具调用", pick(data, ["toolCalls"])], ["消息总数", pick(data, ["totalMessages"])],
  ];
  return <section className="usage-panel" aria-labelledby="usage-panel-title"><div className="panel-heading"><div><span className="panel-kicker">会话统计</span><h2 id="usage-panel-title">用量</h2></div><button type="button" onClick={onRefresh}>刷新</button></div><div className="usage-grid">{metrics.map(([label, value]) => <div className="usage-metric" key={label}><span>{label}</span><strong>{label === "费用" && typeof value === "number" ? `$${value.toFixed(4)}` : number(value)}</strong></div>)}</div><details className="usage-raw"><summary>原始统计</summary><pre>{JSON.stringify(data, null, 2)}</pre></details></section>;
}
