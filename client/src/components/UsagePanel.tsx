export interface UsagePanelProps { stats: Record<string, unknown> | null; onRefresh?: () => void; }
const pick = (stats: Record<string, unknown>, keys: string[]) => { for (const key of keys) if (stats[key] !== undefined && stats[key] !== null) return stats[key]; return 0; };
const number = (value: unknown) => typeof value === "number" ? value.toLocaleString() : String(value ?? "0");

export function UsagePanel({ stats, onRefresh }: UsagePanelProps) {
  const data = stats || {};
  const metrics: [string, unknown][] = [
    ["Input tokens", pick(data, ["inputTokens", "input_tokens", "tokensIn"])],
    ["Output tokens", pick(data, ["outputTokens", "output_tokens", "tokensOut"])],
    ["Cache read", pick(data, ["cacheRead", "cacheReadTokens", "cache_read_tokens"])],
    ["Cache write", pick(data, ["cacheWrite", "cacheWriteTokens", "cache_write_tokens"])],
    ["Cost", pick(data, ["cost", "totalCost", "total_cost"])],
    ["Context", pick(data, ["contextTokens", "context", "contextWindow"])],
    ["Compactions", pick(data, ["compactions", "compactionCount", "compaction_count"])],
  ];
  return <section className="usage-panel" aria-labelledby="usage-panel-title"><div className="panel-heading"><div><span className="panel-kicker">Session telemetry</span><h2 id="usage-panel-title">Usage</h2></div><button type="button" onClick={onRefresh}>Refresh</button></div><div className="usage-grid">{metrics.map(([label, value]) => <div className="usage-metric" key={label as string}><span>{label}</span><strong>{label === "Cost" && typeof value === "number" ? `$${value.toFixed(4)}` : number(value)}</strong></div>)}</div><details className="usage-raw"><summary>Raw stats</summary><pre>{JSON.stringify(data, null, 2)}</pre></details></section>;
}
