import { useEffect, useState } from "react";
import type { RuntimeState } from "./RuntimeBar";

type Command = { name: string; description?: string; source: string };
type ForkMessage = { entryId: string; text: string };
type TreeNode = { id?: string; entry?: { id?: string; type?: string; message?: { role?: string; content?: unknown } }; children?: TreeNode[] };

interface AgentConsoleProps {
  state: RuntimeState | null;
  disabled: boolean;
  onCommand: (type: string, payload?: Record<string, unknown>) => void;
  commands: Command[];
  stats: Record<string, unknown> | null;
  exportedPath: string;
  bashOutput: string;
  queue: { steering: string[]; followUp: string[] };
  tree: TreeNode[];
  forkMessages: ForkMessage[];
}

function nodeLabel(node: TreeNode) {
  const entry = node.entry;
  const content = entry?.message?.content;
  const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((part: any) => part?.text || part?.thinking || "").join("") : "";
  return text || entry?.type || node.id || "会话条目";
}

export function AgentConsole({ state, disabled, onCommand, commands, stats, exportedPath, bashOutput, queue, tree, forkMessages }: AgentConsoleProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [bash, setBash] = useState("");
  const [exportPath, setExportPath] = useState("");

  useEffect(() => setName(state?.sessionName || ""), [state?.sessionName]);

  if (!open) {
    return <button className="runtime-compact" type="button" onClick={() => setOpen(true)} title="打开 Agent 控制台">Agent</button>;
  }

  const runBash = () => {
    const command = bash.trim();
    if (!command) return;
    onCommand("session:bash", { command, excludeFromContext: false });
  };

  return (
    <section className="agent-console" aria-label="Agent 控制台">
      <div className="agent-console-header">
        <strong>Agent 控制台</strong>
        <button type="button" onClick={() => setOpen(false)} title="关闭 Agent 控制台">x</button>
      </div>
      <div className="agent-console-grid">
        <label>
          会话名称
          <div className="agent-console-row">
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="未命名会话" disabled={disabled} />
            <button type="button" onClick={() => onCommand("session:set-name", { name })} disabled={disabled}>保存</button>
          </div>
        </label>
        <label>
          引导消息
          <select value={state?.steeringMode || "one-at-a-time"} onChange={(event) => onCommand("session:set-steering-mode", { mode: event.target.value })} disabled={disabled}>
            <option value="one-at-a-time">逐条处理</option>
            <option value="all">全部处理</option>
          </select>
        </label>
        <label>
          后续消息队列
          <select value={state?.followUpMode || "one-at-a-time"} onChange={(event) => onCommand("session:set-follow-up-mode", { mode: event.target.value })} disabled={disabled}>
            <option value="one-at-a-time">逐条处理</option>
            <option value="all">全部处理</option>
          </select>
        </label>
        <label className="runtime-toggle">
          <input type="checkbox" disabled={disabled} onChange={(event) => onCommand("session:set-auto-retry", { enabled: event.target.checked })} />
          <span>自动重试</span>
        </label>
      </div>
      <div className="agent-console-actions">
        <button type="button" onClick={() => onCommand("session:stats")} disabled={disabled}>刷新统计</button>
        <button type="button" onClick={() => onCommand("session:commands")} disabled={disabled}>刷新命令</button>
        <button type="button" onClick={() => { onCommand("session:tree"); onCommand("session:fork-messages"); }} disabled={disabled}>会话树</button>
        <button type="button" onClick={() => onCommand("session:clone")} disabled={disabled}>克隆</button>
        <button type="button" onClick={() => onCommand("session:abort-retry")} disabled={disabled}>停止重试</button>
      </div>
      <div className="agent-console-row">
        <input value={exportPath} onChange={(event) => setExportPath(event.target.value)} placeholder="HTML 导出路径（可选）" disabled={disabled} />
        <button type="button" onClick={() => onCommand("session:export-html", { outputPath: exportPath })} disabled={disabled}>导出 HTML</button>
      </div>
      {exportedPath && <div className="agent-console-result">已导出：{exportedPath}</div>}
      <div className="agent-console-row">
        <input value={bash} onChange={(event) => setBash(event.target.value)} onKeyDown={(event) => event.key === "Enter" && runBash()} placeholder="运行项目命令" disabled={disabled} />
        <button type="button" onClick={runBash} disabled={disabled}>运行</button>
        <button type="button" onClick={() => onCommand("session:abort-bash")} disabled={disabled}>停止</button>
      </div>
      {bashOutput && <pre className="agent-console-result">{bashOutput}</pre>}
      {(queue.steering.length > 0 || queue.followUp.length > 0) && <div className="agent-console-data queue-display">
        {queue.steering.map((text, index) => <div key={`steer-${index}`}><strong>引导</strong><span>{text}</span></div>)}
        {queue.followUp.map((text, index) => <div key={`follow-${index}`}><strong>后续</strong><span>{text}</span></div>)}
      </div>}
      {tree.length > 0 && <div className="agent-console-data session-tree"><strong>会话树</strong>{tree.map((node, index) => <TreeItem key={node.id || index} node={node} />)}</div>}
      {forkMessages.length > 0 && <div className="agent-console-data fork-list"><strong>从用户消息创建分支</strong>{forkMessages.map((message) => <button key={message.entryId} type="button" onClick={() => onCommand("session:fork", { entryId: message.entryId })} disabled={disabled}>{message.text}</button>)}</div>}
      {(stats || commands.length > 0) && <div className="agent-console-data">
        {stats && <pre>{JSON.stringify(stats, null, 2)}</pre>}
        {commands.length > 0 && <ul>{commands.map((command) => <li key={`${command.source}-${command.name}`}>/{command.name}{command.description ? ` - ${command.description}` : ""}</li>)}</ul>}
      </div>}
    </section>
  );
}

function TreeItem({ node }: { node: TreeNode }) {
  return <div className="session-tree-node"><span title={node.id}>{nodeLabel(node)}</span>{node.children?.map((child, index) => <TreeItem key={child.id || index} node={child} />)}</div>;
}
