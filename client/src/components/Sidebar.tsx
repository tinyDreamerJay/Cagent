import { useEffect, useState } from "react";

interface SidebarProps {
  sessions: { id: string; name: string; date: string }[]; activeSession: string | null;
  onSessionSelect: (id: string) => void; onNewSession: () => void; onSessionDelete?: (id: string) => void; apiKey: string;
  provider: string; availableProviders: string[]; modelsByProvider: Record<string, string[]>;
  selectedModel: string; onModelSelect: (model: string) => void; onProviderSelect: (provider: string) => void;
  onApiKeySet: (key: string, provider: string, mode: "stored" | "session") => void;
  cwd: string; onCwdChange: (cwd: string) => void; mobileOpen: boolean; onMobileClose: () => void;
  providerStates?: { provider: string; configured: boolean; available: boolean; source: string; models: string[]; capabilities: { apiKey: boolean; oauth: boolean }; error?: string }[];
  mcpServers?: { status: string; source: string; error?: string }[]; onOAuth?: (provider: string) => void; onClear?: (provider: string) => void;
}

export function Sidebar(props: SidebarProps) {
  const { sessions, activeSession, onSessionSelect, onNewSession, onSessionDelete, apiKey, provider, availableProviders, modelsByProvider, selectedModel, onModelSelect, onProviderSelect, onApiKeySet, cwd, onCwdChange, mobileOpen, onMobileClose, providerStates = [], mcpServers = [], onOAuth, onClear } = props;
  const [view, setView] = useState<"sessions" | "settings">("sessions");
  const [keyInput, setKeyInput] = useState(""); const [keyMode, setKeyMode] = useState<"stored" | "session">("stored");
  const [selectedProvider, setSelectedProvider] = useState(provider || availableProviders[0] || "deepseek");
  const [cwdInput, setCwdInput] = useState(cwd); const [confirmClear, setConfirmClear] = useState(false); const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => { if (provider && availableProviders.includes(provider)) setSelectedProvider(provider); }, [provider, availableProviders]);
  useEffect(() => setCwdInput(cwd), [cwd]);
  const state = providerStates.find((item) => item.provider === selectedProvider);
  const commitDirectory = () => { const next = cwdInput.trim(); if (next && next !== cwd) onCwdChange(next); else setCwdInput(cwd); };
  const selectProvider = (next: string) => { setSelectedProvider(next); onProviderSelect(next); const models = modelsByProvider[next] || []; if (models.length) onModelSelect(models[0]); };

  return <aside id="sessions-drawer" className={`sidebar ${mobileOpen ? "open" : ""}`} aria-label="项目导航">
    <div className="activity-rail" aria-label="主导航"><button className="rail-brand" type="button" title="Cagent">C</button><button className={view === "sessions" ? "active" : ""} type="button" onClick={() => setView("sessions")} title="会话">会</button><button className={view === "settings" ? "active" : ""} type="button" onClick={() => setView("settings")} title="设置">设</button><span /><button type="button" onClick={onNewSession} title="新建会话">+</button></div>
    <div className="sidebar-content">
      <header className="sidebar-header"><button className="sidebar-close" type="button" onClick={onMobileClose} aria-label="关闭导航">x</button><div className="sidebar-logo">Cagent</div><div className="sidebar-subtitle">{view === "sessions" ? "项目会话" : "运行设置"}</div></header>
      {view === "sessions" ? <><div className="sidebar-actions"><button type="button" onClick={onNewSession}>+ 新建会话</button></div><div className="session-list">{sessions.length ? sessions.map((s) => <div key={s.id} className={`session-row ${s.id === activeSession ? "active" : ""}`}><button className="sidebar-item sidebar-session" onClick={() => { onSessionSelect(s.id); onMobileClose(); }} type="button"><span className="dot" /><span className="sidebar-session-info"><span className="sidebar-session-title">{s.name}</span><span className="sidebar-session-date">{s.date}</span></span></button>{onSessionDelete && <button className="session-delete" type="button" onClick={() => setPendingDelete({ id: s.id, name: s.name })} title="删除会话">x</button>}</div>) : <div className="sidebar-empty">暂无保存的会话</div>}</div></> : <div className="settings-stack">
        <label>服务商<select value={selectedProvider} onChange={(event) => selectProvider(event.target.value)}>{availableProviders.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        {modelsByProvider[selectedProvider]?.length > 0 && <label>模型<select value={selectedModel} onChange={(event) => onModelSelect(event.target.value)}>{modelsByProvider[selectedProvider].map((item) => <option key={item} value={item}>{item}</option>)}</select></label>}
        {state?.capabilities.apiKey !== false && <label>API Key<input type="password" value={keyInput} onChange={(event) => setKeyInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && keyInput.trim()) { onApiKeySet(keyInput.trim(), selectedProvider, keyMode); setKeyInput(""); } }} placeholder="输入 API Key" /></label>}
        <label>凭据范围<select value={keyMode} onChange={(event) => setKeyMode(event.target.value as "stored" | "session")}><option value="stored">保存到 pi</option><option value="session">仅当前会话</option></select></label>
        <div className="settings-actions">{state?.capabilities.oauth && <button type="button" onClick={() => onOAuth?.(selectedProvider)}>OAuth 登录</button>}{state?.configured && <button type="button" className="danger-action" onClick={() => setConfirmClear(true)}>删除凭据</button>}</div>
        <label>项目目录<input value={cwdInput} onChange={(event) => setCwdInput(event.target.value)} onBlur={commitDirectory} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} placeholder="C:\\project" /></label>
        <div className="mcp-note"><strong>MCP</strong><span>{mcpServers[0]?.error || mcpServers[0]?.source || "暂无 MCP 运行信息"}</span></div>
      </div>}
      <footer className="sidebar-footer"><span className={apiKey ? "status-ready" : "status-idle"} />{apiKey ? "凭据已就绪" : "需要配置凭据"}</footer>
    </div>
    {confirmClear && <div className="modal-scrim" role="presentation"><section className="confirm-modal" role="dialog" aria-modal="true" aria-label="删除凭据"><h2>删除凭据？</h2><p>将从 pi 运行环境中删除 {selectedProvider} 的凭据。</p><div><button type="button" onClick={() => setConfirmClear(false)}>取消</button><button type="button" className="danger-action" onClick={() => { onClear?.(selectedProvider); setConfirmClear(false); }}>删除</button></div></section></div>}
    {pendingDelete && <div className="modal-scrim" role="presentation"><section className="confirm-modal" role="dialog" aria-modal="true" aria-label="删除会话"><h2>删除会话？</h2><p>将删除“{pendingDelete.name}”。</p><div><button type="button" onClick={() => setPendingDelete(null)}>取消</button><button type="button" className="danger-action" onClick={() => { onSessionDelete?.(pendingDelete.id); setPendingDelete(null); }}>删除</button></div></section></div>}
  </aside>;
}
