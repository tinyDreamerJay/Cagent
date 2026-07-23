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
  onApiKeySet: (key: string, provider: string) => void;
  cwd: string;
  onCwdChange: (cwd: string) => void;
}

const CagentLogo = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <rect width="24" height="24" rx="6" fill="url(#sbg)"/>
    <rect x="0.5" y="0.5" width="23" height="23" rx="5.5" stroke="#2a2a4a" strokeWidth="0.5"/>
    <text x="12" y="16.5" textAnchor="middle" fontFamily="system-ui" fontWeight="700" fontSize="15" fill="url(#stxt)">C</text>
    <defs>
      <linearGradient id="sbg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#1a1a2e"/>
        <stop offset="100%" stopColor="#0f0f1a"/>
      </linearGradient>
      <linearGradient id="stxt" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#7aa2f7"/>
        <stop offset="100%" stopColor="#3b82f6"/>
      </linearGradient>
    </defs>
  </svg>
);

export function Sidebar({ sessions, activeSession, onSessionSelect, onNewSession, onSessionDelete, apiKey, provider, modelsByProvider, selectedModel, onModelSelect, onApiKeySet, availableProviders, cwd, onCwdChange }: SidebarProps) {
  const [keyInput, setKeyInput] = useState("");
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
    <aside className="sidebar">
      <div className="sidebar-header">
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
          <div
            key={s.id}
            className={`sidebar-item sidebar-session ${s.id === activeSession ? "active" : ""}`}
            onClick={() => onSessionSelect(s.id)}
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
          </div>
        ))
      )}
      <button className="sidebar-item" onClick={onNewSession}>
        <span className="dot" style={{ background: "var(--success)" }} />
        New session
      </button>
      <button className="sidebar-item" onClick={() => setShowSettings(!showSettings)}>
        <span className="dot" style={{ background: apiKey ? "var(--success)" : "var(--warning)" }} />
        Settings
      </button>

      {showSettings && (
        <div style={{ padding: "0 16px 8px" }}>
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
            style={{
              width: "100%",
              padding: "4px 6px",
              marginBottom: 6,
              background: "var(--bg-tertiary)",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              color: "var(--text-primary)",
              fontSize: "11px",
              outline: "none",
            }}
          >
            {(availableProviders || ["deepseek"]).map(p => (
              <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}{modelsByProvider[p]?.length ? ` (${modelsByProvider[p].length})` : ''}</option>
            ))}
          </select>
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onApiKeySet(keyInput.trim(), selProvider);
                setKeyInput("");
                setShowSettings(false);
              }
            }}
            placeholder={`${selProvider === "anthropic" ? "Anthropic" : selProvider === "deepseek" ? "DeepSeek" : "OpenAI"} API Key...`}
            style={{
              width: "100%",
              padding: "6px 8px",
              background: "var(--bg-tertiary)",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              color: "var(--text-primary)",
              fontSize: "12px",
              fontFamily: "var(--font-mono)",
              outline: "none",
            }}
          />
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
            Press Enter to confirm &middot; Stored locally
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 8, marginBottom: 4 }}>
            Working directory
          </div>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
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
              style={{
                flex: 1,
                padding: "4px 6px",
                background: "var(--bg-tertiary)",
                border: "1px solid var(--border)",
                borderRadius: "4px",
                color: "var(--text-primary)",
                fontSize: "11px",
                fontFamily: "var(--font-mono)",
                outline: "none",
              }}
            />
          </div>
          {modelsByProvider[selProvider]?.length > 0 && (
            <>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 8, marginBottom: 4 }}>
                Model
              </div>
              <select
                value={selectedModel}
                onChange={(e) => onModelSelect(e.target.value)}
                style={{
                  width: "100%",
                  padding: "4px 6px",
                  background: "var(--bg-tertiary)",
                  border: "1px solid var(--border)",
                  borderRadius: "4px",
                  color: "var(--text-primary)",
                  fontSize: "11px",
                  outline: "none",
                }}
              >
                {modelsByProvider[selProvider].map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </>
          )}
        </div>
      )}

      <div className="sidebar-section">Sessions</div>

      <div className="sidebar-spacer" />
      <div className="sidebar-footer">v1.0.0 &middot; Cagent</div>
    </aside>
  );
}
