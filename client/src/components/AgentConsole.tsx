import { useEffect, useState } from "react";
import type { RuntimeState } from "./RuntimeBar";

type Command = { name: string; description?: string; source: string };

interface AgentConsoleProps {
  state: RuntimeState | null;
  disabled: boolean;
  onCommand: (type: string, payload?: Record<string, unknown>) => void;
  commands: Command[];
  stats: Record<string, unknown> | null;
  exportedPath: string;
  bashOutput: string;
}

export function AgentConsole({ state, disabled, onCommand, commands, stats, exportedPath, bashOutput }: AgentConsoleProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [bash, setBash] = useState("");
  const [exportPath, setExportPath] = useState("");

  useEffect(() => setName(state?.sessionName || ""), [state?.sessionName]);

  if (!open) {
    return <button className="runtime-compact" type="button" onClick={() => setOpen(true)} title="Open agent controls">Agent</button>;
  }

  const runBash = () => {
    const command = bash.trim();
    if (!command) return;
    onCommand("session:bash", { command, excludeFromContext: false });
  };

  return (
    <section className="agent-console" aria-label="Agent controls">
      <div className="agent-console-header">
        <strong>Agent controls</strong>
        <button type="button" onClick={() => setOpen(false)} title="Close agent controls">x</button>
      </div>
      <div className="agent-console-grid">
        <label>
          Session name
          <div className="agent-console-row">
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Untitled session" disabled={disabled} />
            <button type="button" onClick={() => onCommand("session:set-name", { name })} disabled={disabled}>Save</button>
          </div>
        </label>
        <label>
          Steering
          <select value={state?.steeringMode || "one-at-a-time"} onChange={(event) => onCommand("session:set-steering-mode", { mode: event.target.value })} disabled={disabled}>
            <option value="one-at-a-time">One at a time</option>
            <option value="all">All</option>
          </select>
        </label>
        <label>
          Follow-up queue
          <select value={state?.followUpMode || "one-at-a-time"} onChange={(event) => onCommand("session:set-follow-up-mode", { mode: event.target.value })} disabled={disabled}>
            <option value="one-at-a-time">One at a time</option>
            <option value="all">All</option>
          </select>
        </label>
        <label className="runtime-toggle">
          <input type="checkbox" disabled={disabled} onChange={(event) => onCommand("session:set-auto-retry", { enabled: event.target.checked })} />
          <span>Auto retry</span>
        </label>
      </div>
      <div className="agent-console-actions">
        <button type="button" onClick={() => onCommand("session:stats")} disabled={disabled}>Refresh stats</button>
        <button type="button" onClick={() => onCommand("session:commands")} disabled={disabled}>Refresh commands</button>
        <button type="button" onClick={() => onCommand("session:tree")} disabled={disabled}>Session tree</button>
        <button type="button" onClick={() => onCommand("session:clone")} disabled={disabled}>Clone</button>
        <button type="button" onClick={() => onCommand("session:abort-retry")} disabled={disabled}>Abort retry</button>
      </div>
      <div className="agent-console-row">
        <input value={exportPath} onChange={(event) => setExportPath(event.target.value)} placeholder="HTML export path (optional)" disabled={disabled} />
        <button type="button" onClick={() => onCommand("session:export-html", { outputPath: exportPath })} disabled={disabled}>Export HTML</button>
      </div>
      {exportedPath && <div className="agent-console-result">Exported: {exportedPath}</div>}
      <div className="agent-console-row">
        <input value={bash} onChange={(event) => setBash(event.target.value)} onKeyDown={(event) => event.key === "Enter" && runBash()} placeholder="Run a project command" disabled={disabled} />
        <button type="button" onClick={runBash} disabled={disabled}>Run</button>
        <button type="button" onClick={() => onCommand("session:abort-bash")} disabled={disabled}>Stop</button>
      </div>
      {bashOutput && <pre className="agent-console-result">{bashOutput}</pre>}
      {(stats || commands.length > 0) && <div className="agent-console-data">
        {stats && <pre>{JSON.stringify(stats, null, 2)}</pre>}
        {commands.length > 0 && <ul>{commands.map((command) => <li key={`${command.source}-${command.name}`}>/{command.name}{command.description ? ` - ${command.description}` : ""}</li>)}</ul>}
      </div>}
    </section>
  );
}
