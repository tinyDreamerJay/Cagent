import { useCallback, useEffect, useState } from "react";

type Entry = { name: string; directory: boolean };
type Approval = { id: string; type: string; summary: string };
type GitState = { branch: string; status: string; diff: string; worktrees: string };

export function WorkspacePanel() {
  const api = window.cagent?.workspace;
  const [cwd, setCwd] = useState("");
  const [relativePath, setRelativePath] = useState(".");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [preview, setPreview] = useState("");
  const [git, setGit] = useState<GitState | null>(null);
  const [command, setCommand] = useState("");
  const [terminalOutput, setTerminalOutput] = useState("");
  const [terminalRunning, setTerminalRunning] = useState(false);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [error, setError] = useState("");

  const loadFiles = useCallback(async (nextPath = ".") => {
    try {
      setError("");
      const result = await api?.request("list", { path: nextPath });
      if (result) { setRelativePath(result.path); setEntries(result.entries); }
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, [api]);

  useEffect(() => {
    api?.request("root").then((result) => { setCwd(result.cwd); loadFiles(); }).catch((err) => setError(String(err)));
    return api?.onEvent((message) => {
      if (message.type === "workspace:approval") setApproval(message.payload);
      if (message.type === "terminal:data") setTerminalOutput((value) => value + message.payload.data);
      if (message.type === "terminal:status") setTerminalRunning(message.payload.running);
      if (message.type === "cwd:updated") { setCwd(message.payload.cwd); loadFiles(); }
    });
  }, [api, loadFiles]);

  const openEntry = async (entry: Entry) => {
    const nextPath = relativePath === "." ? entry.name : `${relativePath}/${entry.name}`;
    if (entry.directory) return loadFiles(nextPath);
    try { const result = await api?.request("read", { path: nextPath }); setPreview(result?.content || ""); } catch (err) { setError(String(err)); }
  };
  const request = async (type: string, payload?: unknown) => { try { setError(""); const result = await api?.request(type, payload); if (result?.id) setApproval(result); return result; } catch (err) { setError(err instanceof Error ? err.message : String(err)); return null; } };
  const approve = async () => { if (!approval) return; await request("approve", { id: approval.id }); setApproval(null); };
  const deny = async () => { if (approval) await request("deny", { id: approval.id }); setApproval(null); };
  const parent = relativePath.split(/[\\/]/).slice(0, -1).join("/") || ".";

  return (
    <aside className="workspace-panel" aria-label="Project workspace">
      <div className="workspace-title">WORKSPACE<span title={cwd}>{cwd || "Loading..."}</span></div>
      <div className="workspace-actions">
        <button type="button" onClick={() => request("choose-directory")}>Choose project</button>
        <button type="button" onClick={() => loadFiles()}>Refresh files</button>
        <button type="button" onClick={async () => setGit(await api?.request("git-status"))}>Git</button>
      </div>
      <div className="workspace-status" aria-live="polite">{terminalRunning ? "Terminal running" : "Terminal idle"}{git?.branch ? ` · ${git.branch}` : ""}</div>
      {error && <div className="workspace-error" role="alert">{error}</div>}
      <div className="workspace-tree" aria-label="Project files">
        {relativePath !== "." && <button type="button" onClick={() => loadFiles(parent)}>..</button>}
        {entries.length === 0 && !error && <div className="workspace-empty">No files</div>}
        {entries.map((entry) => <button type="button" key={entry.name} onClick={() => openEntry(entry)}>{entry.directory ? "▸ " : "  "}{entry.name}</button>)}
      </div>
      {git && <><pre className="workspace-output" aria-label="Git status">{git.branch}\n{git.status || "clean"}\n{git.diff}\n{git.worktrees}</pre><div className="workspace-actions"><button type="button" onClick={() => request("git-stage", { paths: git.status.split("\n").filter(Boolean).map((line) => line.slice(3).trim()) })}>Stage changed</button><button type="button" onClick={() => request("git-commit", { message: window.prompt("Commit message") || "Update" })}>Commit</button><button type="button" onClick={() => request("git-branch", { name: window.prompt("Branch name") || "codex/workspace" })}>New branch</button><button type="button" onClick={() => request("worktree-add", { name: window.prompt("Worktree name") || "codex-worktree" })}>New worktree</button></div></>}
      {preview && <pre className="workspace-preview" aria-label="File preview">{preview}</pre>}
      <div className="workspace-terminal">
        <div className="terminal-actions"><button type="button" onClick={() => request("terminal-start")}>Start</button><button type="button" onClick={() => request("terminal-kill")}>Kill</button></div>
        <input aria-label="Terminal command" value={command} onChange={(event) => setCommand(event.target.value)} placeholder="Run command..." onKeyDown={(event) => { if (event.key === "Enter" && command.trim()) { request("terminal", { command }); setCommand(""); } }} />
        <pre aria-label="Terminal output">{terminalOutput || "Terminal ready"}</pre>
      </div>
      {approval && <div className="approval-dialog" role="dialog" aria-label="Operation approval"><strong>需要审批</strong><span>{approval.summary}</span><button type="button" onClick={approve}>Approve</button><button type="button" onClick={deny}>Deny</button></div>}
    </aside>
  );
}
