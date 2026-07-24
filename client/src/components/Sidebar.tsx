import { useState, useEffect } from "react";

interface SidebarProps {
  sessions: { id: string; name: string; date: string }[];
  activeSession: string | null;
  onSessionSelect: (id: string) => void;
  onNewSession: () => void;
  onSessionDelete?: (id: string) => void;
  apiKey: string;
  provider: string;
  availableProviders: string[];
  modelsByProvider: Record<string, string[]>;
  selectedModel: string;
  onModelSelect: (model: string) => void;
  onApiKeySet: (key: string, provider: string, mode: "stored" | "session") => void;
  cwd: string;
  onCwdChange: (cwd: string) => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
  providerStates?: { provider: string; configured: boolean; available: boolean; source: string; models: string[]; capabilities: { apiKey: boolean; oauth: boolean }; error?: string }[];
  mcpServers?: { status: string; source: string; error?: string }[];
  onOAuth?: (provider: string) => void;
  onClear?: (provider: string) => void;
}

const CagentLogo = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <rect width="24" height="24" rx="4" fill="#163635"/>
    <rect x="0.5" y="0.5" width="23" height="23" rx="3.5" stroke="#3a5b56"/>
    <path d="M16.6 8.1a6.2 6.2 0 1 0 0 7.8" stroke="#8ed1be" strokeWidth="2.3" strokeLinecap="square"/>
  </svg>
);

export function Sidebar({ sessions, activeSession, onSessionSelect, onNewSession, onSessionDelete, apiKey, provider, modelsByProvider, selectedModel, onModelSelect, onApiKeySet, availableProviders, cwd, onCwdChange, mobileOpen, onMobileClose, providerStates = [], mcpServers = [], onOAuth, onClear }: SidebarProps) {
  const [keyInput, setKeyInput] = useState("");
  const [keyMode, setKeyMode] = useState<"stored" | "session">("stored");
  const [showSettings, setShowSettings] = useState(false);
  const [selProvider, setSelProvider] = useState(provider || (availableProviders?.[0] || "deepseek"));
  const [cwdInput, setCwdInput] = useState(cwd);

  // 外部 provider 变化时同步 selProvider
  useEffect(() => {
    if (provider && provider !== selProvider && availableProviders.includes(provider)) {
      setSelProvider(provider);
    }
  }, [provider, selProvider, availableProviders]);

  useEffect(() => {
    setCwdInput(cwd);
  }, [cwd]);

  const commitWorkingDirectory = () => {
    const nextCwd = cwdInput.trim();
    if (!nextCwd) {
      setCwdInput(cwd);
      return;
    }
    if (nextCwd !== cwd) onCwdChange(nextCwd);
  };

  return (
    <aside id="sessions-drawer" className={`sidebar ${mobileOpen ? "open" : ""}`} aria-label="Sessions">
      <div className="sidebar-header">
        <button className="sidebar-close" type="button" aria-label="Close sessions" onClick={onMobileClose}>x</button>
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">
            <CagentLogo />
          </div>
          C<span>agent</span>
        </div>
        <div className="sidebar-subtitle">Coding Agent</div>
      </div>

      {modelsByProvider[selProvider]?.length > 0 && (
        <div className="sidebar-quick-model">
          <div className="sidebar-quick-model-label">Model</div>
          <select
            value={selectedModel}
            onChange={(e) => onModelSelect(e.target.value)}
          >
            {modelsByProvider[selProvider].map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      )}

      <div className="sidebar-section">Actions</div>
      {sessions.length === 0 ? (
        <div className="sidebar-item" style={{ cursor: "default", opacity: 0.4 }}>
          No sessions
        </div>
      ) : (
        sessions.map((s) => (
          <button
            key={s.id}
            className={`sidebar-item sidebar-session ${s.id === activeSession ? "active" : ""}`}
            onClick={() => { onSessionSelect(s.id); onMobileClose(); }}
            type="button"
          >
            <span className="dot" />
            <div className="sidebar-session-info">
              <span className="sidebar-session-title">{s.name}</span>
              <span className="sidebar-session-date">{s.date}</span>
            </div>
            {onSessionDelete && (
              <button
                className="sidebar-session-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  onSessionDelete(s.id);
                }}
                title="Delete session"
              >
                x
              </button>
            )}
          </button>
        ))
      )}
      <button className="sidebar-item" onClick={() => { onNewSession(); onMobileClose(); }}>
        <span className="dot" style={{ background: "var(--success)" }} />
        New session
      </button>
      <button className="sidebar-item" onClick={() => setShowSettings(!showSettings)}>
        <span className="dot" style={{ background: apiKey ? "var(--success)" : "var(--warning)" }} />
        Settings
      </button>

      {showSettings && (
        <div className="sidebar-settings">
          <select
            value={selProvider}
            onChange={(e) => {
              const newProv = e.target.value;
              setSelProvider(newProv);
              // 切换 provider 时，自动选中该 provider 下的第一个模型
              const provModels = modelsByProvider[newProv] || [];
              if (provModels.length > 0) {
                onModelSelect(provModels[0]);
              }
            }}
          >
            {(availableProviders || ["deepseek"]).map(p => (
              <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}{modelsByProvider[p]?.length ? ` (${modelsByProvider[p].length})` : ''}</option>
            ))}
          </select>
          {providerStates.find((item) => item.provider === selProvider)?.capabilities?.apiKey !== false && <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onApiKeySet(keyInput.trim(), selProvider, keyMode);
                setKeyInput("");
                setShowSettings(false);
              }
            }}
            placeholder={`${selProvider === "anthropic" ? "Anthropic" : selProvider === "deepseek" ? "DeepSeek" : "OpenAI"} API Key...`}
          />}
          <div className="settings-hint">
            Enter to save &middot; Secret stays in pi runtime
          </div>
          <select value={keyMode} onChange={(event) => setKeyMode(event.target.value as "stored" | "session")}><option value="stored">Save to pi</option><option value="session">Session only</option></select>
          {providerStates.find((item) => item.provider === selProvider)?.capabilities?.oauth && <button type="button" className="settings-action" onClick={() => onOAuth?.(selProvider)}>Sign in with OAuth</button>}
          {providerStates.find((item) => item.provider === selProvider)?.configured && <button type="button" className="settings-action" onClick={() => window.confirm("Remove this credential from pi?") && onClear?.(selProvider)}>Remove credential</button>}
          <div className="settings-label">
            Working directory
          </div>
          <div className="settings-row">
            <input
              type="text"
              value={cwdInput}
              onChange={(e) => setCwdInput(e.target.value)}
              onBlur={commitWorkingDirectory}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                }
              }}
              placeholder="C:\\project"
            />
          </div>
          {modelsByProvider[selProvider]?.length > 0 && (
            <>
              <div className="settings-label">
                Model
              </div>
              <select
                value={selectedModel}
                onChange={(e) => onModelSelect(e.target.value)}
              >
                {modelsByProvider[selProvider].map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </>
          )}
        </div>
      )}

      <div className="sidebar-section">MCP</div>
      <div className="settings-hint mcp-summary">{mcpServers[0]?.error || "Pi 0.81.1 has no built-in MCP"}</div>

      <div className="sidebar-section">Sessions</div>

      <div className="sidebar-spacer" />
      <div className="sidebar-footer">v1.0.0 &middot; Cagent</div>
    </aside>
  );
}
