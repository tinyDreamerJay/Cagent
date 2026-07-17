import React, { useState, useRef, useEffect, useCallback } from "react";
import { Sidebar } from "./components/Sidebar";
import { useWebSocket } from "./hooks/useWebSocket";
import { MessageContent } from "./components/MessageContent";
import { useConversations, Message, ToolCall } from "./hooks/useConversations";

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
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
          <h2>应用错误</h2>
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
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("cagent_apikey") || "");
  const [provider, setProvider] = useState(() => localStorage.getItem("cagent_provider") || "");
  const [availableProviders, setAvailableProviders] = useState<string[]>(["deepseek"]);
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [initDone, setInitDone] = useState(false);
  const pendingApiKeyRef = useRef<{ key: string; provider: string } | null>(null);
  const [statusMsg, setStatusMsg] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bufferRef = useRef("");
  const rafRef = useRef<number | null>(null);
  const streamingTextRef = useRef("");
  const pendingImagesRef = useRef<{ data: string; mimeType: string }[]>([]);

  // Conversation persistence
  const {
    conversations,
    activeConversation,
    activeId,
    createConversation,
    updateConversation,
    deleteConversation,
    switchConversation,
  } = useConversations();
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  const prevActiveIdRef = useRef(activeId);

  // Sync local messages when switching conversations
  useEffect(() => {
    if (activeId !== prevActiveIdRef.current) {
      prevActiveIdRef.current = activeId;
      setMessages(activeConversation?.messages || []);
      streamingTextRef.current = "";
    }
  }, [activeId, activeConversation]);

  // Persist current messages to the active conversation
  const saveActiveConversation = useCallback(() => {
    const id = activeIdRef.current;
    if (!id) return;
    const msgs = messagesRef.current;
    if (msgs.length === 0) return;
    updateConversation(id, msgs);
  }, [updateConversation]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Handle incoming WebSocket messages
  useEffect(() => {
    const unsubs: (() => void)[] = [];

    unsubs.push(
      subscribe("status", (p: { message: string }) => {
        setStatusMsg(p.message);
      })
    );

    unsubs.push(
      subscribe("session:ready", () => {
        setInitDone(true);
        setStatusMsg("");
        send("auth:providers");
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
     subscribe("auth:key-ready", (p: { provider: string; models?: string[] }) => {
        if (p.models && p.models.length > 0) {
          setModels(p.models);
          setSelectedModel((prev) => prev || p.models![0]);
        }
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
          const last = copy[copy.length - 1];
          if (last?.role === "assistant" && last.id === "streaming") {
            copy[copy.length - 1] = { ...last, id: `msg-${Date.now()}` };
          }
          return copy;
        });
        streamingTextRef.current = "";
        setSending(false);
        setStreaming(false);
        // Persist after message completes
        setTimeout(() => saveActiveConversation(), 0);
      })
    );

    unsubs.push(
      subscribe("tool:call", (p: { name: string; params: any }) => {
        const toolCall: ToolCall = {
          id: `tool-${Date.now()}`,
          name: p.name,
          params: typeof p.params === "string" ? p.params : JSON.stringify(p.params, null, 2),
          collapsed: false,
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
        // Persist on abort too
        setTimeout(() => saveActiveConversation(), 0);
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
            { id: `err-${Date.now()}`, role: "error", text: `閿熸枻鎷烽敓鏂ゆ嫹: ${msg}` },
          ];
          return next;
        });
      })
    );

    return () => unsubs.forEach((u) => u());
  }, [subscribe, send, saveActiveConversation]);

  const handleSend = () => {
    const text = input.trim();
    const images = pendingImagesRef.current;
    if (!text && images.length === 0) return;
    if (sending) return;

    // Ensure there is an active conversation
    let convId = activeIdRef.current;
    if (!convId) {
      convId = createConversation();
    }

    const userMsg: Message = { id: `msg-${Date.now()}`, role: "user", text, images: images.length > 0 ? images : undefined };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    pendingImagesRef.current = [];
    setSending(true);
    setStreaming(true);

    // Persist user message immediately
    setTimeout(() => {
      if (convId) {
        updateConversation(convId, messagesRef.current);
      }
    }, 0);

    send("session:prompt", { text, model: selectedModel, images: images.length > 0 ? images : undefined });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Handle paste for images
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
          setInput((prev) => prev); // force re-render
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
  };

  const handleApiKeySet = (key: string, prov: string) => {
    if (!key) return;
    localStorage.setItem("cagent_apikey", key);
    localStorage.setItem("cagent_provider", prov);
    setApiKey(key);
    setProvider(prov);
    setModels([]);
    setSelectedModel("");
    if (initDone) {
      send("auth:set-key", { provider: prov, apiKey: key });
    } else {
      pendingApiKeyRef.current = { key, provider: prov };
    }
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
    // Save current conversation first if there are messages
    const currentId = activeIdRef.current;
    const currentMsgs = messagesRef.current;
    if (currentId && currentMsgs.length > 0) {
      updateConversation(currentId, currentMsgs);
    }
    createConversation();
    setMessages([]);
    setInput("");
  };

  const handleSessionSelect = (id: string) => {
    // Save current before switching
    const currentId = activeIdRef.current;
    const currentMsgs = messagesRef.current;
    if (currentId && currentMsgs.length > 0 && currentId !== id) {
      updateConversation(currentId, currentMsgs);
    }
    switchConversation(id);
  };

  const handleSessionDelete = (id: string) => {
    deleteConversation(id);
    if (activeIdRef.current === id) {
      // The active conversation was deleted, clear messages
      setMessages([]);
      setInput("");
    }
  };

  return (
    <ErrorBoundary>
    <div className="app-container">
      <Sidebar
        sessions={conversations.map(c => ({
          id: c.id,
          name: c.title,
          date: new Date(c.updatedAt).toLocaleDateString("zh-CN", { month: "short", day: "numeric" }),
        }))}
        activeSession={activeId}
        onSessionSelect={handleSessionSelect}
        onNewSession={handleNewSession}
        onSessionDelete={handleSessionDelete}
        apiKey={apiKey}
        provider={provider}
        availableProviders={availableProviders}
        models={models}
        selectedModel={selectedModel}
        onModelSelect={handleModelSelect}
        onApiKeySet={handleApiKeySet}
      />

      <main className="main-area">
        <header className="chat-header">
          <span className="chat-header-title">
            {!connected ? "閿熸枻鎷?閿熸枻鎷烽敓鏂ゆ嫹閿熸枻鎷?.." :
             !initDone ? "閿熸枻鎷?閿熸枻鎷峰閿熸枻鎷烽敓鏂ゆ嫹..." :
             apiKey ? "閿熸枻鎷?閿熸枻鎷烽敓鏂ゆ嫹" : "閿熸枻鎷?閿熸枻鎷疯 API Key"}
          </span>
          {statusMsg && (
            <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 8 }}>{statusMsg}</span>
          )}
          <span className="chat-header-model">
            {selectedModel || "Cagent"}
          </span>
        </header>

        <div className="messages-container">
          {messages.length === 0 ? (
            <div className="welcome">
              <div className="welcome-icon">?</div>
              <div className="welcome-title">Cagent</div>
              <div className="welcome-text">
                涓€閿熸枻鎷烽敓鏂ゆ嫹閿熸枻鎷疯皨閿熸枻鎷?Agent閿熸枻鎷烽敓鏂ゆ嫹閿熸枻鎷烽敓鏂ゆ嫹閿熸枻鎷峰彇閿熸枻鎷峰啓閿熻銆侀敓娲佽緫閿熶茎纭锋嫹閿熸枻鎷烽敓鏂ゆ嫹閿熸枻鎷烽敓鏂ゆ嫹閿熸枻鎷烽敓绛嬨€                涓€閿熸枻鎷烽敓鏂ゆ嫹钀嶉敓鏂ゆ嫹閿熼樁銊楊澁鎷烽敓              </div>
              {!apiKey && initDone && (
                <div style={{
                  marginTop: 16, padding: "10px 16px", background: "var(--bg-tertiary)",
                  border: "1px solid var(--warning)", borderRadius: "var(--radius)",
                  fontSize: 13, color: "var(--warning)", maxWidth: 400
                }}>
                  ?? 閿熸枻鎷烽敓鏂ゆ嫹閿熸枻鎷烽敓鏂ゆ嫹閿熸枻鎷烽敓鏂ゆ嫹閿?API Key閿熸枻鎷烽敓鏂ゆ嫹閿熸枻鎷烽敓鐫嚖鎷蜂娇閿熸枻鎷                </div>
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
                          alt={`附件 ${i + 1}`}
                          onClick={() => window.open(`data:${img.mimeType};base64,${img.data}`,'_blank')}
                          title="点击查看大图"
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
                      <span className={`tool-block-icon ${tc.name}`}>
                        {tc.name[0]?.toUpperCase()}
                      </span>
                      <span style={{ flex: 1 }}>{tc.name}</span>
                      <span style={{ fontSize: 10 }}>{tc.collapsed ? "▼" : "▲"}</span>
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
                    閿熸枻鎷                  </button>
                </div>
              ))}
              <div style={{ fontSize: 11, color: "var(--text-muted)", alignSelf: "center", marginLeft: 8 }}>
                {pendingImagesRef.current.length} 閿熸枻鎷峰浘鐗?閿熸枻鎷?閿熸枻鎷烽敓鏂ゆ嫹閿熸枻鎷烽敓琛楃尨鎷烽敓鏂ゆ嫹
              </div>
            </div>
          )}
          <div className="input-wrapper">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={sending ? "■" : "↑"}
              rows={1}
              disabled={sending || !apiKey || !initDone}
            />
            <button
              className={`send-btn ${sending ? "sending" : ""}`}
              onClick={sending ? () => send("session:abort") : handleSend}
              disabled={(!input.trim() && pendingImagesRef.current.length === 0 && !sending) || !apiKey || !initDone}
              title={sending ? "鍋滄" : "閿熸枻鎷烽敓鏂ゆ嫹"}
            >
              {sending ? "閿熸枻鎷? : "閿熸枻鎷?}
            </button>
          </div>
        </div>
      </main>
    </div>
    </ErrorBoundary>
  );
}

export default App;




              </div>
            </div>
            <div ref={messagesEndRef} />
          </div>
          ))}
