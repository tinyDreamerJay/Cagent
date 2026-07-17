import { useState } from "react";

interface SidebarProps {
  sessions: { id: string; name: string; date: string }[];
  activeSession: string | null;
  onSessionSelect: (id: string) => void;
  onNewSession: () => void;
  onSessionDelete: (id: string) => void;
  apiKey: string;
  provider: string;
  availableProviders: string[];
  models: string[];
  selectedModel: string;
  onModelSelect: (model: string) => void;
  onApiKeySet: (key: string, provider: string) => void;
}

export function Sidebar({ sessions, activeSession, onSessionSelect, onNewSession, onSessionDelete, apiKey, provider, models, selectedModel, onModelSelect, onApiKeySet, availableProviders }: SidebarProps) {
  const [keyInput, setKeyInput] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [selProvider, setSelProvider] = useState(provider || (availableProviders?.[0] || "deepseek"));

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          C<span>agent</span>
        </div>
        <div className="sidebar-subtitle">编程 Agent</div>
      </div>

      <div className="sidebar-section">操作</div>
      <button className="sidebar-item" onClick={onNewSession}>
        <span className="dot" style={{ background: "var(--success)" }} />
        新建会话
      </button>
      <button className="sidebar-item" onClick={() => setShowSettings(!showSettings)}>
        <span className="dot" style={{ background: apiKey ? "var(--success)" : "var(--warning)" }} />
        设置 API Key
      </button>

      {showSettings && (
        <div style={{ padding: "0 16px 8px" }}>
          <select
            value={selProvider}
            onChange={(e) => setSelProvider(e.target.value)}
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
              <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
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
            placeholder={`输入 ${selProvider === "anthropic" ? "Anthropic" : selProvider === "deepseek" ? "DeepSeek" : "OpenAI"} API Key...`}
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
            按 Enter 确认 · 仅存储在本地
          </div>
          {models.length > 0 && (
            <>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 8, marginBottom: 4 }}>
                模型
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
                {models.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </>
          )}
        </div>
      )}

      <div className="sidebar-section">会话列表</div>

      <div className="sidebar-spacer" />
      <div className="sidebar-footer">v1.0.0 · 极简</div>
    </aside>
  );
}
 interface SidebarProps {
   sessions: { id: string; name: string; date: string }[];
   activeSession: string | null;
   onSessionSelect: (id: string) => void;
   onNewSession: () => void;
   onSessionDelete: (id: string) => void;
   apiKey: string;
   provider: string;
   availableProviders: string[];
   onApiKeySet: (key: string, provider: string) => void;
 }
       {sessions.length === 0 ? (
         <div className="sidebar-item" style={{ cursor: "default", opacity: 0.4 }}>
           暂无会话
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
             <button
               className="sidebar-session-delete"
               onClick={(e) => {
                 e.stopPropagation();
                 onSessionDelete(s.id);
               }}
               title="删除会话"
             >
               ×
             </button>
           </div>
         ))
       )}
