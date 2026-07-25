import { useMemo, useState } from "react";

export type ResourceKind = "skill" | "prompt" | "extension" | "command" | string;
export interface PiResource {
  name: string;
  kind: ResourceKind;
  source?: string;
  path?: string;
  status?: "active" | "disabled" | "error" | "unavailable" | string;
  error?: string;
  description?: string;
}

interface ResourceCenterProps {
  resources: PiResource[];
  loading?: boolean;
  error?: string;
  onReload?: (resource?: PiResource) => void;
  onOpen?: (resource: PiResource) => void;
  onExport?: (format: "html" | "jsonl") => void;
}

const labels: Record<string, string> = { skill: "Skills", prompt: "提示词模板", extension: "扩展", command: "命令" };
const statusLabels: Record<string, string> = { active: "已启用", disabled: "已禁用", error: "错误", unavailable: "不可用", unknown: "未知" };

export function ResourceCenter({ resources, loading, error, onReload, onOpen, onExport }: ResourceCenterProps) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const groups = useMemo(() => resources.filter((item) => (filter === "all" || item.kind === filter) &&
    (!query || `${item.name} ${item.source || ""} ${item.path || ""}`.toLowerCase().includes(query.toLowerCase()))), [resources, filter, query]);
  return <section className="resource-center" aria-labelledby="resource-center-title">
    <div className="panel-heading"><div><span className="panel-kicker">pi 资源清单</span><h2 id="resource-center-title">资源中心</h2></div><span className="panel-count">显示 {groups.length} 项</span></div>
    <div className="resource-toolbar"><input aria-label="筛选资源" placeholder="按名称或路径筛选" value={query} onChange={(e) => setQuery(e.target.value)} />
      <select aria-label="资源类型" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">全部类型</option>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <button type="button" onClick={() => onReload?.()} title="刷新资源清单">刷新</button>
      <button type="button" onClick={() => onExport?.("html")}>导出 HTML</button><button type="button" onClick={() => onExport?.("jsonl")}>导出 JSONL</button>
    </div>
    <div className="resource-list">{loading ? <div className="panel-empty">正在扫描 pi 资源...</div> : error ? <div className="panel-empty resource-error">{error}</div> : groups.length === 0 ? <div className="panel-empty">未发现资源</div> : groups.map((item) => {
      return <article className={`resource-row status-${item.status || "active"}`} key={`${item.kind}:${item.name}:${item.path || ""}`}>
        <div className="resource-main"><div className="resource-name">{item.name}<span className="resource-kind">{labels[item.kind] || item.kind}</span></div><div className="resource-meta">{item.source || "来源未知"}{item.path ? ` · ${item.path}` : ""}</div>{item.error && <div className="resource-error">{item.error}</div>}</div>
        <span className="resource-status">{statusLabels[item.status || "unknown"] || item.status}</span><div className="resource-actions">{onOpen && item.path && <button type="button" onClick={() => onOpen(item)}>打开位置</button>}</div>
      </article>;
    })}</div>
  </section>;
}
