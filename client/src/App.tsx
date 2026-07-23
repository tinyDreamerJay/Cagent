import React, { useState, useRef, useEffect, useCallback } from "react";
import { Sidebar } from "./components/Sidebar";
import { useWebSocket } from "./hooks/useWebSocket";
import { MessageContent } from "./components/MessageContent";
import { type Message, type ToolCall } from "./hooks/useConversations";
import { RuntimeBar, type RuntimeState } from "./components/RuntimeBar";

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  constructor(props: any) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, color: "#ff6b6b", fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
          <h2>Application Error</h2>
          <p>{this.state.error.message}</p>
          <pre style={{ fontSize: 12, opacity: 0.7 }}>{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const { connected, send, subscribe } = useWebSocket();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [cwd, setCwd] = useState(() => localStorage.getItem("cagent_cwd") || "");
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("cagent_apikey") || "");
  const [provider, setProvider] = useState(() => localStorage.getItem("cagent_provider") || "");
  const [availableProviders, setAvailableProviders] = useState<string[]>(["anthropic", "openai", "deepseek"]);
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, string[]>>({});
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [initDone, setInitDone] = useState(false);
  const pendingApiKeyRef = useRef<{ key: string; provider: string } | null>(null);
  const [statusMsg, setStatusMsg] = useState("");
  const [runtimeState, setRuntimeState] = useState<RuntimeState | null>(null);
  const [thinkingLevels, setThinkingLevels] = useState<string[]>([]);
  const [piSessions, setPiSessions] = useState<{ id: string; path: string; name: string; updatedAt: number }[]>([]);
  const [activeSessionPath, setActiveSessionPath] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bufferRef = useRef("");
  const rafRef = useRef<number | null>(null);
  const streamingTextRef = useRef("");
  const pendingImagesRef = useRef<{ data: string; mimeType: string }[]>([]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    const unsubs: (() => void)[] = [];

    unsubs.push(
      subscribe("status", (p: { message: string }) => {
        setStatusMsg(p.message);
      })
    );

    unsubs.push(
      subscribe("session:ready", (p: { cwd?: string; sessionFile?: string }) => {
        setInitDone(true);
        setStatusMsg("");
        if (p?.cwd) {
          const normalized = p.cwd.replace(/\\/g, "/");
          localStorage.setItem("cagent_cwd", normalized);
          setCwd(normalized);
        }
        setActiveSessionPath(p?.sessionFile || null);
        send("auth:providers");
      })
    );

    unsubs.push(
      subscribe("session:list", (sessions: { id: string; path: string; name: string; updatedAt: number }[]) => {
        setPiSessions(Array.isArray(sessions) ? sessions : []);
      })
    );

    unsubs.push(
      subscribe("session:messages", (nextMessages: Message[]) => {
        setMessages(Array.isArray(nextMessages) ? nextMessages : []);
        streamingTextRef.current = "";
      })
    );

    unsubs.push(
      subscribe("session:state", (p: RuntimeState) => {
        setRuntimeState(p);
        if (p?.cwd) setCwd(p.cwd.replace(/\\/g, "/"));
      })
    );

    unsubs.push(
      subscribe("session:thinking-levels", (levels: string[]) => {
        setThinkingLevels(Array.isArray(levels) ? levels : []);
      })
    );

    unsubs.push(
      subscribe("auth:providers", (p: string[]) => {
        setAvailableProviders(p);
        const savedProvider = localStorage.getItem("cagent_provider");
        if (!p.includes(savedProvider || "")) {
          const newProvider = p[0] || "deepseek";
          setProvider(newProvider);
          localStorage.setItem("cagent_provider", newProvider);
        }
        const pending = pendingApiKeyRef.current;
        if (pending) {
          pendingApiKeyRef.current = null;
          if (p.includes(pending.provider)) {
            send("auth:set-key", { provider: pending.provider, apiKey: pending.key });
          }
        } else {
          const savedKey = localStorage.getItem("cagent_apikey");
          const finalProvider = p.includes(savedProvider || "") ? savedProvider! : p[0];
          if (savedKey && finalProvider) {
            setProvider(finalProvider);
            send("auth:set-key", { provider: finalProvider, apiKey: savedKey });
          }
        }
      })
    );

    unsubs.push(
      subscribe("auth:key-ready", (p: { provider: string; models?: string[]; source?: string }) => {
        setApiKey((prev) => prev || "__environment_credential__");
        setModelsByProvider((prev) => {
          const updated = { ...prev };
          if (p.models && p.models.length > 0) {
            updated[p.provider] = p.models;
          }
          // 如果是第一次有模型，自动选中第一个
          const hasAnyModels = Object.values(updated).some((m) => m.length > 0);
          if (hasAnyModels) {
            setTimeout(() => {
              setSelectedModel((current) => {
                if (current) return current; // 已有选择就不动
                // 找第一个有模型的 provider
                const first = Object.entries(updated).find(([, ms]) => ms.length > 0);
                if (first) {
                  setProvider(first[0]);
                  return first[1][0];
                }
                return current;
              });
            }, 0);
          }
          return updated;
        });
      })
    );

    unsubs.push(
      subscribe("token", (p: { text: string }) => {
        bufferRef.current += p.text;
        if (!rafRef.current) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null;
            streamingTextRef.current += bufferRef.current;
            bufferRef.current = "";
            setMessages((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last?.role === "assistant" && last.id === "streaming") {
                copy[copy.length - 1] = { ...last, text: streamingTextRef.current };
              } else {
                copy.push({ id: "streaming", role: "assistant", text: streamingTextRef.current });
              }
              return copy;
            });
          });
        }
      })
    );

    unsubs.push(
      subscribe("message:done", () => {
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        bufferRef.current = "";
        setMessages((prev) => {
          const copy = [...prev];
          const streamingIndex = copy.findLastIndex((message) => message.role === "assistant" && message.id === "streaming");
          if (streamingIndex >= 0) {
            const streamingMessage = copy[streamingIndex];
            if (streamingMessage.text.trim()) {
              copy[streamingIndex] = { ...streamingMessage, id: `msg-${Date.now()}` };
            } else {
              copy.splice(streamingIndex, 1);
            }
          }
          return copy;
        });
        streamingTextRef.current = "";
        setSending(false);
        setStreaming(false);
        send("session:list");
      })
    );

    unsubs.push(
      subscribe("tool:call", (p: { name: string; params: any }) => {
        const toolName = typeof p?.name === "string" && p.name.trim() ? p.name : "tool";
        const toolParams = typeof p?.params === "string" ? p.params : (JSON.stringify(p?.params ?? {}, null, 2) || "");
        const toolCall: ToolCall = {
          id: `tool-${Date.now()}`,
          name: toolName,
          params: toolParams,
          collapsed: true,
        };
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last?.role === "assistant") {
            const updated = {
              ...last,
              toolCalls: [...(last.toolCalls || []), toolCall],
            };
            copy[copy.length - 1] = updated;
          }
          return copy;
        });
      })
    );

    unsubs.push(
      subscribe("tool:result", (p: { name: string; output: string }) => {
        setMessages((prev) => {
          const copy = [...prev];
          for (let i = copy.length - 1; i >= 0; i--) {
            const tc = copy[i].toolCalls;
            if (tc) {
              for (let j = tc.length - 1; j >= 0; j--) {
                if (tc[j].name === p.name && !tc[j].result) {
                  const updated = { ...copy[i] };
                  const updatedTCs = [...(updated.toolCalls || [])];
                  updatedTCs[j] = { ...updatedTCs[j], result: p.output };
                  updated.toolCalls = updatedTCs;
                  copy[i] = updated;
                  return [...copy];
                }
              }
            }
          }
          return copy;
        });
      })
    );

    unsubs.push(
      subscribe("message:aborted", () => {
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        bufferRef.current = "";
        streamingTextRef.current = "";
        setSending(false);
        setStreaming(false);
        send("session:list");
      })
    );

    unsubs.push(
      subscribe("cwd:updated", (p: { cwd: string }) => {
        if (p?.cwd) setCwd(p.cwd.replace(/\\/g, "/"));
      })
    );

    unsubs.push(
      subscribe("error", (p: any) => {
        if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        bufferRef.current = "";
        streamingTextRef.current = "";
        setSending(false);
        setStreaming(false);
        const msg = typeof p === "string" ? p : (p?.message || JSON.stringify(p));
        setMessages((prev) => {
          const next = [
            ...prev,
            { id: `err-${Date.now()}`, role: "error" as const, text: `Error: ${msg}` },
          ];
          return next;
        });
      })
    );

    return () => unsubs.forEach((u) => u());
  }, [subscribe, send]);

  const handleSend = () => {
    const text = input.trim();
    const images = pendingImagesRef.current;
    if (!text && images.length === 0) return;
    if (sending) return;

    const userMsg: Message = { id: `msg-${Date.now()}`, role: "user", text, images: images.length > 0 ? images : undefined };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    pendingImagesRef.current = [];
    setSending(true);
    setStreaming(true);

    send("session:prompt", { text, model: selectedModel, provider, cwd: cwd || undefined, images: images.length > 0 ? images : undefined });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (!blob) continue;
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const [header, base64] = dataUrl.split(",");
          const mimeType = header.match(/data:(.*?);/)?.[1] || "image/png";
          pendingImagesRef.current = [...pendingImagesRef.current, { data: base64, mimeType }];
          setInput((prev) => prev);
        };
        reader.readAsDataURL(blob);
      }
    }
  }, []);

  useEffect(() => {
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  const handleModelSelect = (model: string) => {
    setSelectedModel(model);
    // 找出这个模型对应的 provider 并更新
    setModelsByProvider((current) => {
      for (const [prov, mods] of Object.entries(current)) {
        if (mods.includes(model)) {
          setProvider(prov);
          localStorage.setItem("cagent_provider", prov);
          break;
        }
      }
      return current;
    });
  };

  const handleApiKeySet = (key: string, prov: string) => {
    if (!key) return;
    localStorage.setItem("cagent_apikey", key);
    localStorage.setItem("cagent_provider", prov);
    setApiKey(key);
    setProvider(prov);
    setModelsByProvider({});
    setSelectedModel("");
    if (initDone) {
      send("auth:set-key", { provider: prov, apiKey: key });
    } else {
      pendingApiKeyRef.current = { key, provider: prov };
    }
  };

  const handleCwdChange = (newCwd: string) => {
    if (!newCwd) return;
    const normalized = newCwd.replace(/\\/g, "/");
    localStorage.setItem("cagent_cwd", normalized);
    setCwd(normalized);
    send("session:set-cwd", { cwd: normalized });
  };

  const toggleToolCollapse = (msgId: string, toolId: string) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id === msgId && m.toolCalls) {
          return {
            ...m,
            toolCalls: m.toolCalls.map((tc) =>
              tc.id === toolId ? { ...tc, collapsed: !tc.collapsed } : tc
            ),
          };
        }
        return m;
      })
    );
  };

  const handleNewSession = () => {
    setMessages([]);
    setInput("");
    setStatusMsg("Starting a new pi session...");
    send("session:new");
  };

  const handleSessionSelect = (id: string) => {
    if (id !== activeSessionPath) {
      setStatusMsg("Loading pi session...");
      send("session:switch", { path: id });
    }
  };

  return (
    <ErrorBoundary>
    <div className="app-container">
      <Sidebar
        sessions={piSessions.map(session => ({
          id: session.path,
          name: session.name,
          date: new Date(session.updatedAt).toLocaleDateString("zh-CN", { month: "short", day: "numeric" }),
        }))}
        activeSession={activeSessionPath}
        onSessionSelect={handleSessionSelect}
        onNewSession={handleNewSession}
        apiKey={apiKey}
        provider={provider}
        availableProviders={availableProviders}
        modelsByProvider={modelsByProvider}
        selectedModel={selectedModel}
        onModelSelect={handleModelSelect}
        onApiKeySet={handleApiKeySet}
        cwd={cwd}
        onCwdChange={handleCwdChange}
      />

      <main className="main-area">
        <header className="chat-header">
          <span className="chat-header-title">
            {!connected ? "Connecting..." :
             !initDone ? "Initializing..." :
             apiKey ? "Ready" : "Set API Key"}
          </span>
          {statusMsg && (
            <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 8 }}>{statusMsg}</span>
          )}
          <span className="chat-header-model">
            {selectedModel || "Cagent"}
          </span>
        </header>

        <RuntimeBar
          state={runtimeState}
          thinkingLevels={thinkingLevels}
          disabled={!initDone || sending}
          onThinkingChange={(level) => send("session:set-thinking", { level })}
          onAutoCompactionChange={(enabled) => send("session:set-auto-compaction", { enabled })}
          onCompact={() => send("session:compact")}
        />

        <div className="messages-container">
          {messages.length === 0 ? (
            <div className="welcome">
              <div className="welcome-icon">
                <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                  <rect width="64" height="64" rx="14" fill="url(#wbg)"/>
                  <rect x="1" y="1" width="62" height="62" rx="13" fill="none" stroke="#2a2a4a" stroke-width="0.5"/>
                  <text x="32" y="44" text-anchor="middle" font-family="system-ui" font-weight="700" font-size="40" fill="url(#wtxt)">C</text>
                  <defs>
                    <linearGradient id="wbg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stop-color="#1a1a2e"/>
                      <stop offset="100%" stop-color="#0f0f1a"/>
                    </linearGradient>
                    <linearGradient id="wtxt" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stop-color="#7aa2f7"/>
                      <stop offset="100%" stop-color="#3b82f6"/>
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              <div className="welcome-title">Cagent</div>
              <div className="welcome-text">
                A minimalist coding agent. Use your AI to read, write, edit, and debug your project.
              </div>
              {!apiKey && initDone && (
                <div className="welcome-hint">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{flexShrink:0}}>
                    <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5"/>
                    <text x="7" y="10" textAnchor="middle" fontSize="10" fill="currentColor">!</text>
                  </svg>
                  Enter your API key in the sidebar to get started
                </div>
              )}
            </div>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} className={`message ${msg.role}`}>
                <div className="message-content">
                  {msg.role === 'assistant'
                    ? <MessageContent text={msg.text} />
                    : msg.text}
                  {msg.images && msg.images.length > 0 && (
                    <div className="message-images">
                      {msg.images.map((img, i) => (
                        <img
                          key={i}
                          src={`data:${img.mimeType};base64,${img.data}`}
                          alt={`attached image ${i + 1}`}
                          onClick={() => window.open(`data:${img.mimeType};base64,${img.data}`,'_blank')}
                          title="click to view full size"
                        />
                    ))}
                  </div>
                )}
                {msg.id === "streaming" && streaming && (
                  <span className="typing-indicator" style={{ display: "inline-flex", marginLeft: 4 }}>
                    <span />
                  </span>
                )}
                {msg.toolCalls?.map((tc) => (
                  <div key={tc.id} className="tool-block">
                    <div
                      className="tool-block-header"
                      onClick={() => toggleToolCollapse(msg.id, tc.id)}
                    >
                      <span className={`tool-block-icon ${tc.name || "tool"}`}>
                        {(tc.name || "tool")[0]?.toUpperCase()}
                      </span>
                      <span style={{ flex: 1 }}>{tc.name}</span>
                      <span style={{ fontSize: 10 }}>{tc.collapsed ? "expand" : "collapse"}</span>
                    </div>
                    <div className={`tool-block-body ${tc.collapsed ? "collapsed" : ""}`}>
                      {tc.params && <div style={{ marginBottom: tc.result ? 8 : 0 }}>{tc.params}</div>}
                      {tc.result && (
                        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                          {tc.result}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
                <div ref={messagesEndRef} />
              </div>
            )))}
        </div>

        <div className="input-container">
          {pendingImagesRef.current.length > 0 && (
            <div className="image-preview-bar">
              {pendingImagesRef.current.map((img, i) => (
                <div key={i} className="image-preview-thumb">
                  <img src={`data:${img.mimeType};base64,${img.data}`} alt="" />
                  <button
                    className="image-preview-remove"
                    onClick={() => {
                      pendingImagesRef.current = pendingImagesRef.current.filter((_, j) => j !== i);
                      setInput((prev) => prev);
                    }}
                  >
                    x
                  </button>
                </div>
              ))}
              <div style={{ fontSize: 11, color: "var(--text-muted)", alignSelf: "center", marginLeft: 8 }}>
                {pendingImagesRef.current.length} image(s) added - send to include
              </div>
            </div>
          )}
          <div className="input-wrapper">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={sending ? "Stop..." : "Ask anything..."}
              rows={1}
              disabled={sending || !apiKey || !initDone}
            />
            <button
              className={`send-btn ${sending ? "sending" : ""}`}
              onClick={sending ? () => send("session:abort") : handleSend}
              disabled={(!input.trim() && pendingImagesRef.current.length === 0 && !sending) || !apiKey || !initDone}
              title={sending ? "Stop" : "Send"}
            >
              {sending ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                  <rect x="3" y="3" width="8" height="8" rx="1"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                  <path d="M2 1l11 6-11 6V1z"/>
                </svg>
              )}
            </button>
          </div>
        </div>
      </main>
    </div>
    </ErrorBoundary>
  );
}

export default App;
