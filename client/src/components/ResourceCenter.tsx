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
  onReload?: (resource?: PiResource) => void;
  onToggle?: (resource: PiResource, enabled: boolean) => void;
  onOpen?: (resource: PiResource) => void;
  onExport?: (format: "html" | "jsonl") => void;
  onImport?: (file: File) => void;
}

const labels: Record<string, string> = { skill: "Skills", prompt: "Prompt templates", extension: "Extensions", command: "Commands" };

export function ResourceCenter({ resources, onReload, onToggle, onOpen, onExport, onImport }: ResourceCenterProps) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const groups = useMemo(() => resources.filter((item) => (filter === "all" || item.kind === filter) &&
    (!query || `${item.name} ${item.source || ""} ${item.path || ""}`.toLowerCase().includes(query.toLowerCase()))), [resources, filter, query]);
  return <section className="resource-center" aria-labelledby="resource-center-title">
    <div className="panel-heading"><div><span className="panel-kicker">Pi inventory</span><h2 id="resource-center-title">Resource center</h2></div><span className="panel-count">{groups.length} visible</span></div>
    <div className="resource-toolbar"><input aria-label="Filter resources" placeholder="Filter by name or path" value={query} onChange={(e) => setQuery(e.target.value)} />
      <select aria-label="Resource type" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All types</option>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <button type="button" onClick={() => onReload?.()} title="Reload resources">Reload</button>
      <label className="file-button">Import<input type="file" accept=".jsonl,.json" onChange={(e) => e.target.files?.[0] && onImport?.(e.target.files[0])} /></label>
      <button type="button" onClick={() => onExport?.("html")}>HTML</button><button type="button" onClick={() => onExport?.("jsonl")}>JSONL</button>
    </div>
    <div className="resource-list">{groups.length === 0 ? <div className="panel-empty">No resources match this filter.</div> : groups.map((item) => {
      const disabled = item.status === "disabled";
      return <article className={`resource-row status-${item.status || "active"}`} key={`${item.kind}:${item.name}:${item.path || ""}`}>
        <div className="resource-main"><div className="resource-name">{item.name}<span className="resource-kind">{labels[item.kind] || item.kind}</span></div><div className="resource-meta">{item.source || "unknown source"}{item.path ? ` · ${item.path}` : ""}</div>{item.error && <div className="resource-error">{item.error}</div>}</div>
        <span className="resource-status">{item.status || "active"}</span><div className="resource-actions">{onToggle && (item.kind === "extension" || item.kind === "skill") && <button type="button" onClick={() => onToggle(item, disabled)}>{disabled ? "Enable" : "Disable"}</button>}{onOpen && item.path && <button type="button" onClick={() => onOpen(item)}>Open</button>}<button type="button" onClick={() => onReload?.(item)}>Reload</button></div>
      </article>;
    })}</div>
  </section>;
}
