import React, { useState, useRef, useEffect, useCallback } from "react";
import { Sidebar } from "./components/Sidebar";
import { useWebSocket } from "./hooks/useWebSocket";
import { MessageContent } from "./components/MessageContent";
import { type Message, type ToolCall } from "./hooks/useConversations";
import { RuntimeBar, type RuntimeState } from "./components/RuntimeBar";
import { AgentConsole } from "./components/AgentConsole";

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

function ExtensionWidget({ lines }: { lines: string[] }) {
  return <div className="extension-widget">{lines.map((line, index) => <div key={index}>{line}</div>)}</div>;
}

function App() {
  const { connected, send, subscribe } = useWebSocket();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
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
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [commands, setCommands] = useState<{ name: string; description?: string; source: string }[]>([]);
  const [commandIndex, setCommandIndex] = useState(0);
  const [exportedPath, setExportedPath] = useState("");
  const [bashOutput, setBashOutput] = useState("");
  const [extensionRequest, setExtensionRequest] = useState<any>(null);
  const [extensionValue, setExtensionValue] = useState("");
  const [extensionWidgets, setExtensionWidgets] = useState<Record<string, { lines: string[]; placement: "aboveEditor" | "belowEditor" }>>({});
  const [queuedMessages, setQueuedMessages] = useState({ steering: [] as string[], followUp: [] as string[] });
  const [sessionTree, setSessionTree] = useState<any[]>([]);
  const [forkMessages, setForkMessages] = useState<{ entryId: string; text: string }[]>([]);
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

  const updateTool = useCallback((p: { id?: string; name: string; output: string }, status: "running" | "done" | "error") => {
    setMessages((prev) => prev.map((message) => ({
      ...message,
      toolCalls: message.toolCalls?.map((tool) => (p.id ? tool.id === p.id : tool.name === p.name && tool.status === "running")
        ? { ...tool, result: p.output || tool.result, status }
        : tool),
    })));
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
        send("session:commands");
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

    unsubs.push(subscribe("session:stats", (value: Record<string, unknown>) => setStats(value || null)));
    unsubs.push(subscribe("session:commands", (value: { name: string; description?: string; source: string }[]) => setCommands(Array.isArray(value) ? value : [])));
    unsubs.push(subscribe("session:exported", (value: { path?: string }) => setExportedPath(value?.path || "")));
    unsubs.push(subscribe("session:bash-result", (value: unknown) => setBashOutput(JSON.stringify(value, null, 2))));
    unsubs.push(subscribe("session:queue", (value: { steering?: string[]; followUp?: string[] }) => setQueuedMessages({ steering: value?.steering || [], followUp: value?.followUp || [] })));
    unsubs.push(subscribe("session:tree", (value: { tree?: any[] }) => setSessionTree(value?.tree || [])));
    unsubs.push(subscribe("session:fork-messages", (value: { entryId: string; text: string }[]) => setForkMessages(Array.isArray(value) ? value : [])));
    unsubs.push(subscribe("pi:extension-ui", (value: any) => {
      if (value?.method === "notify") {
        setStatusMsg(value.message || "");
        return;
      }
      if (value?.method === "setStatus") {
        setStatusMsg(value.statusText || "");
        return;
      }
      if (value?.method === "setTitle" && value.title) {
        document.title = value.title;
        return;
      }
      if (value?.method === "setWidget" && value.widgetKey) {
        setExtensionWidgets((previous) => {
          const next = { ...previous };
          if (Array.isArray(value.widgetLines)) next[value.widgetKey] = { lines: value.widgetLines, placement: value.widgetPlacement === "aboveEditor" ? "aboveEditor" : "belowEditor" };
          else delete next[value.widgetKey];
          return next;
        });
        return;
      }
      if (value?.method === "set_editor_text") {
        setInput(value.text || "");
        requestAnimationFrame(() => inputRef.current?.focus());
        return;
      }
      if (value?.id) {
        setExtensionValue(value.prefill || "");
        setExtensionRequest(value);
      }
    }));

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

    unsubs.push(subscribe("thinking:delta", (p: { text: string }) => {
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant" && last.id === "streaming") copy[copy.length - 1] = { ...last, thinking: `${last.thinking || ""}${p.text || ""}` };
        else copy.push({ id: "streaming", role: "assistant", text: "", thinking: p.text || "" });
        return copy;
      });
    }));

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
      subscribe("tool:call", (p: { id?: string; name: string; params: any }) => {
        const toolName = typeof p?.name === "string" && p.name.trim() ? p.name : "tool";
        const toolParams = typeof p?.params === "string" ? p.params : (JSON.stringify(p?.params ?? {}, null, 2) || "");
        const toolCall: ToolCall = {
          id: p.id || `tool-${Date.now()}`,
          name: toolName,
          params: toolParams,
          collapsed: true,
          status: "running",
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
          } else {
            copy.push({ id: "streaming", role: "assistant", text: "", toolCalls: [toolCall] });
          }
          return copy;
        });
      })
    );

    unsubs.push(subscribe("tool:update", (p: { id?: string; name: string; output: string }) => updateTool(p, "running")));

    unsubs.push(
      subscribe("tool:result", (p: { id?: string; name: string; output: string; isError?: boolean }) => {
        setMessages((prev) => {
          const copy = [...prev];
          for (let i = copy.length - 1; i >= 0; i--) {
            const tc = copy[i].toolCalls;
            if (tc) {
              for (let j = tc.length - 1; j >= 0; j--) {
                if ((p.id ? tc[j].id === p.id : tc[j].name === p.name && !tc[j].result)) {
                  const updated = { ...copy[i] };
                  const updatedTCs = [...(updated.toolCalls || [])];
                  updatedTCs[j] = { ...updatedTCs[j], result: p.output, status: p.isError ? "error" : "done" };
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
  }, [subscribe, send, updateTool]);

  const handleSend = () => {
    const text = input.trim();
    const images = pendingImagesRef.current;
    if (!text && images.length === 0) return;
    if (sending) {
      send("session:steer", { text, images: images.length > 0 ? images : undefined });
      setInput("");
      pendingImagesRef.current = [];
      return;
    }

    const userMsg: Message = { id: `msg-${Date.now()}`, role: "user", text, images: images.length > 0 ? images : undefined };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    pendingImagesRef.current = [];
    setSending(true);
    setStreaming(true);

    send("session:prompt", { text, model: selectedModel, provider, cwd: cwd || undefined, images: images.length > 0 ? images : undefined });
  };

  const slashQuery = input.startsWith("/") && !input.slice(1).includes(" ")
    ? input.slice(1).toLowerCase()
    : null;
  const slashMatches = slashQuery === null
    ? []
    : commands.filter((command) => command.name.toLowerCase().includes(slashQuery)).slice(0, 10);

  const selectSlashCommand = (name: string) => {
    setInput(`/${name} `);
    setCommandIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (slashMatches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCommandIndex((current) => (current + 1) % slashMatches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setCommandIndex((current) => (current - 1 + slashMatches.length) % slashMatches.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && slashQuery !== null)) {
        e.preventDefault();
        selectSlashCommand(slashMatches[Math.min(commandIndex, slashMatches.length - 1)].name);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setInput("");
        return;
      }
    }
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

  const respondToExtension = (confirmed?: boolean, cancelled?: boolean) => {
    if (!extensionRequest) return;
    const payload: Record<string, unknown> = { id: extensionRequest.id };
    if (cancelled) payload.cancelled = true;
    else if (extensionRequest.method === "confirm") payload.confirmed = Boolean(confirmed);
    else payload.value = extensionValue;
    send("extension:respond", payload);
    setExtensionRequest(null);
    setExtensionValue("");
  };

  return (
    <ErrorBoundary>
    <div className="app-container">
      {extensionRequest && (
        <div className="extension-overlay" role="dialog" aria-modal="true" aria-label={extensionRequest.title || "Extension request"}>
          <div className="extension-dialog">
            <h2>{extensionRequest.title || "Extension request"}</h2>
            {extensionRequest.message && <p>{extensionRequest.message}</p>}
            {extensionRequest.method === "select" && (
              <select value={extensionValue} onChange={(event) => setExtensionValue(event.target.value)}>
                <option value="">Select an option</option>
                {(extensionRequest.options || []).map((option: string) => <option key={option} value={option}>{option}</option>)}
              </select>
            )}
            {(extensionRequest.method === "input" || extensionRequest.method === "editor") && (
              extensionRequest.method === "editor"
                ? <textarea value={extensionValue} onChange={(event) => setExtensionValue(event.target.value)} placeholder={extensionRequest.placeholder || ""} rows={8} />
                : <input autoFocus value={extensionValue} onChange={(event) => setExtensionValue(event.target.value)} placeholder={extensionRequest.placeholder || ""} />
            )}
            <div className="extension-dialog-actions">
              <button type="button" onClick={() => respondToExtension(undefined, true)}>Cancel</button>
              {extensionRequest.method === "confirm" ? <><button type="button" onClick={() => respondToExtension(false)}>No</button><button type="button" onClick={() => respondToExtension(true)}>Yes</button></> : <button type="button" onClick={() => respondToExtension()}>Continue</button>}
            </div>
          </div>
        </div>
      )}
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
        mobileOpen={sidebarOpen}
        onMobileClose={() => setSidebarOpen(false)}
      />

      <main className="main-area">
        <header className="chat-header">
          <button className="sidebar-toggle" type="button" onClick={() => setSidebarOpen((open) => !open)} aria-label="Toggle sessions">Sessions</button>
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
        <div className="agent-console-anchor">
          <AgentConsole
            state={runtimeState}
            disabled={!initDone || sending}
            onCommand={send}
            commands={commands}
            stats={stats}
            exportedPath={exportedPath}
            bashOutput={bashOutput}
            queue={queuedMessages}
            tree={sessionTree}
            forkMessages={forkMessages}
          />
        </div>

        <div className="messages-container">
          {messages.length === 0 ? (
            <div className="welcome">
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
                {msg.thinking && <details className="thinking-block"><summary>Thinking</summary><pre>{msg.thinking}</pre></details>}
                {msg.toolCalls?.map((tc) => (
                  <div key={tc.id} className="tool-block">
                    <div
                      className="tool-block-header"
                      onClick={() => toggleToolCollapse(msg.id, tc.id)}
                    >
                      <span className={`tool-block-icon ${tc.name || "tool"}`}>
                        {(tc.name || "tool")[0]?.toUpperCase()}
                      </span>
                      <span style={{ flex: 1 }}>{tc.name}</span><span className={`tool-status ${tc.status || "done"}`}>{tc.status === "running" ? "running" : tc.status === "error" ? "failed" : "done"}</span>
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
          {Object.entries(extensionWidgets).filter(([, widget]) => widget.placement === "aboveEditor").map(([key, widget]) => <ExtensionWidget key={key} lines={widget.lines} />)}
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
          {slashMatches.length > 0 && (
            <div className="slash-palette" role="listbox" aria-label="Pi commands">
              {slashMatches.map((command, index) => (
                <button
                  key={`${command.source}-${command.name}`}
                  type="button"
                  className={index === commandIndex ? "active" : ""}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectSlashCommand(command.name)}
                  role="option"
                  aria-selected={index === commandIndex}
                >
                  <span className="slash-command-name">/{command.name}</span>
                  <span className="slash-command-description">{command.description || command.source}</span>
                  <span className="slash-command-source">{command.source}</span>
                </button>
              ))}
            </div>
          )}
          <div className="input-wrapper">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => { setInput(e.target.value); setCommandIndex(0); }}
              onKeyDown={handleKeyDown}
              placeholder={sending ? "Queue a steer or follow-up message..." : "Ask anything..."}
              rows={1}
              disabled={!apiKey || !initDone}
            />
            <button
              className={`send-btn ${sending ? "sending" : ""}`}
              onClick={handleSend}
              disabled={(!input.trim() && pendingImagesRef.current.length === 0 && !sending) || !apiKey || !initDone}
              title={sending ? "Queue steering message" : "Send"}
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
            {sending && <>
              <button className="queue-btn" type="button" onClick={() => {
                const text = input.trim();
                if (!text) return;
                send("session:follow-up", { text, images: pendingImagesRef.current });
                setInput("");
                pendingImagesRef.current = [];
              }} disabled={!input.trim()} title="Run after the current response settles">Follow-up</button>
              <button className="queue-btn stop-btn" type="button" onClick={() => send("session:abort")} title="Stop generating">Stop</button>
            </>}
          </div>
          {Object.entries(extensionWidgets).filter(([, widget]) => widget.placement === "belowEditor").map(([key, widget]) => <ExtensionWidget key={key} lines={widget.lines} />)}
        </div>
      </main>
    </div>
    </ErrorBoundary>
  );
}

export default App;
