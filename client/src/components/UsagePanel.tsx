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
    ["Input tokens", pick(data, ["tokens.input", "inputTokens", "input_tokens", "tokensIn"])],
    ["Output tokens", pick(data, ["tokens.output", "outputTokens", "output_tokens", "tokensOut"])],
    ["Cache read", pick(data, ["tokens.cacheRead", "cache.read", "cacheRead", "cacheReadTokens", "cache_read_tokens"])],
    ["Cache write", pick(data, ["tokens.cacheWrite", "cache.write", "cacheWrite", "cacheWriteTokens", "cache_write_tokens"])],
    ["Cost", pick(data, ["cost", "totalCost", "total_cost"])],
    ["Context", pick(data, ["context.used", "contextTokens", "context", "contextWindow"])],
    ["Compactions", pick(data, ["compaction.count", "compactions", "compactionCount", "compaction_count"])],
  ];
  return <section className="usage-panel" aria-labelledby="usage-panel-title"><div className="panel-heading"><div><span className="panel-kicker">Session telemetry</span><h2 id="usage-panel-title">Usage</h2></div><button type="button" onClick={onRefresh}>Refresh</button></div><div className="usage-grid">{metrics.map(([label, value]) => <div className="usage-metric" key={label as string}><span>{label}</span><strong>{label === "Cost" && typeof value === "number" ? `$${value.toFixed(4)}` : number(value)}</strong></div>)}</div><details className="usage-raw"><summary>Raw stats</summary><pre>{JSON.stringify(data, null, 2)}</pre></details></section>;
}
