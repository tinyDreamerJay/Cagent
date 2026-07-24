// Cagent embedded server (runs as child process of Electron)
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { WebSocketServer, WebSocket } = require("ws");
const { createServer: createHttpServer } = require("http");

const PORT = process.env.PORT || 4120;

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createHttpServer(app);
const wss = new WebSocketServer({ server: httpServer });

function discoverMcp() {
  for (const file of [path.join(os.homedir(), ".pi", "agent", "mcp.json"), path.join(os.homedir(), ".pi", "agent", "settings.json")]) {
    try {
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      const servers = value.mcpServers || value.mcp || {};
      return Object.entries(servers).map(([name, cfg]) => ({ name, source: file, status: "configured", tools: [], error: cfg?.command ? undefined : "pi 0.81.1 未提供 MCP RPC" }));
    } catch { /* no local config */ }
  }
  return [];
}

// Lazy load pi SDK (ESM-only)
let piSDK = null;
async function getPiSDK() {
  if (!piSDK) {
    piSDK = await import("@earendil-works/pi-coding-agent");
  }
  return piSDK;
}

// getRegisteredProviderIds() only contains extension providers. Include all
// built-in pi-agent providers so ccswitch/API configurations can be selected.
function getProviderIds(rt) {
  const ids = new Set();
  for (const provider of (rt?.getProviders?.() || [])) {
    if (provider?.id) ids.add(provider.id);
  }
  for (const id of (rt?.getRegisteredProviderIds?.() || [])) ids.add(id);
  return [...ids];
}

async function sendConfiguredProviderStates(ws, rt, ids) {
  for (const provider of ids) {
    try {
      const status = rt.getProviderAuthStatus?.(provider);
      if (!status?.configured) continue;
      const models = await rt.getAvailable(provider);
      if (models.length > 0) {
        ws.send(JSON.stringify({
          type: "auth:key-ready",
          payload: { provider, models: models.map(m => m.id), source: status.source },
        }));
      }
    } catch (_) {
      // Keep listing the provider; the user can configure it from the UI.
    }
  }
}

function loadCcswitchCodexConfig() {
  try {
    const home = os.homedir();
    const text = fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8");
    const providerId = text.match(/^model_provider\s*=\s*["']([^"']+)["']/m)?.[1];
    const modelId = text.match(/^model\s*=\s*["']([^"']+)["']/m)?.[1] || "gpt-5";
    if (!providerId) return null;
    const escaped = providerId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const section = text.match(new RegExp(`\\[model_providers\\.${escaped}\\]([\\s\\S]*?)(?=\\n\\[|$)`))?.[1] || "";
    const baseUrl = section.match(/^base_url\s*=\s*["']([^"']+)["']/m)?.[1];
    if (!baseUrl) return null;
    let apiKey;
    try {
      const auth = JSON.parse(fs.readFileSync(path.join(home, ".codex", "auth.json"), "utf8"));
      apiKey = auth.OPENAI_API_KEY || auth.api_key;
    } catch (_) {}
    return { providerId, modelId, baseUrl, apiKey, wireApi: section.match(/^wire_api\s*=\s*["']([^"']+)["']/m)?.[1] };
  } catch (_) {
    return null;
  }
}

async function registerCcswitchProvider(rt) {
  const cfg = loadCcswitchCodexConfig();
  if (!cfg) return;
  const api = cfg.wireApi === "responses" ? "openai-responses" : "openai-completions";
  rt.registerProvider(cfg.providerId, {
    name: `ccswitch: ${cfg.providerId}`,
    baseUrl: cfg.baseUrl,
    api,
    models: [{ id: cfg.modelId, name: cfg.modelId, api, reasoning: true, input: ["text"], contextWindow: 1000000, maxTokens: 32768, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
  });
  if (cfg.apiKey) await rt.setRuntimeApiKey(cfg.providerId, cfg.apiKey);
  console.log(`[Cagent] ccswitch Codex provider imported: ${cfg.providerId}`);
}

// Session manager
let sessionManager = null;
let modelRuntime = null;
let resolvedModel = null;
let agentSession = null;

function registerDeepSeekProvider(rt) {
  rt.registerProvider("deepseek", {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "$CAGENT_DEEPSEEK_API_KEY",
    api: "openai-completions",
    models: [
      {
        id: "deepseek-chat",
        name: "DeepSeek Chat",
        api: "openai-completions",
        reasoning: false,
        input: ["text", "image"],
        contextWindow: 128000,
        maxTokens: 8192,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      {
        id: "deepseek-reasoner",
        name: "DeepSeek Reasoner",
        api: "openai-completions",
        reasoning: true,
        input: ["text"],
        contextWindow: 128000,
        maxTokens: 8192,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ],
  });
}

async function initSession() {
  const pi = await getPiSDK();
  if (!sessionManager) {
    sessionManager = pi.SessionManager.inMemory();
  }
  if (!modelRuntime) {
    modelRuntime = await pi.ModelRuntime.create();
    // Register DeepSeek as a custom provider
    try {
      registerDeepSeekProvider(modelRuntime);
      await registerCcswitchProvider(modelRuntime);
      console.log("[Cagent] DeepSeek provider registered");
    } catch (err) {
      console.log("[Cagent] Failed to register DeepSeek:", err.message);
    }
  }
  return { pi, sessionManager, modelRuntime };
}

wss.on("connection", (ws) => {
  console.log("[Cagent] Client connected");
  let currentSession = null;
  let abortCtrl = null;

  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const { type, payload } = msg;

      switch (type) {
        case "session:init": {
          console.log("[Cagent] session:init received");
          ws.send(JSON.stringify({ type: "status", payload: { message: "加载中..." } }));
          try {
            await initSession();
            console.log("[Cagent] session:init done");
            // Try to cache a model after initialization
            try {
              const providers = getProviderIds(modelRuntime);
              for (const pid of providers) {
                const available = await modelRuntime.getAvailable(pid);
                if (available.length > 0) {
                  resolvedModel = available[0];
                  break;
                }
              }
            } catch (e) {
              // Model not available yet — will resolve on first prompt
            }
            ws.send(JSON.stringify({ type: "session:ready", payload: {} }));
          } catch (err) {
            console.log("[Cagent] session:init error:", err.message);
            ws.send(JSON.stringify({ type: "error", payload: { message: err.message } }));
          }
          break;
        }

        case "session:prompt": {
          console.log("[Cagent] session:prompt received:", JSON.stringify(payload).slice(0, 100));
          if (!modelRuntime || !sessionManager) {
            console.log("[Cagent] Not initialized");
            ws.send(JSON.stringify({ type: "error", payload: { message: "未初始化" } }));
            return;
          }

          try {
            const pi = await getPiSDK();

            // Resolve model: prefer explicit modelId, fallback to cached/default
            const modelChanged = payload.model && resolvedModel && payload.model !== resolvedModel.id;
            if (!resolvedModel || modelChanged) {
              if (payload.model) {
                const providers = getProviderIds(modelRuntime);
                for (const pid of providers) {
                  const available = await modelRuntime.getAvailable(pid);
                  const found = available.find(m => m.id === payload.model);
                  if (found) {
                    resolvedModel = found;
                    console.log("[Cagent] Using requested model:", resolvedModel.provider, resolvedModel.id);
                    break;
                  }
                }
              }
              if (!resolvedModel) {
                const providers = getProviderIds(modelRuntime);
                for (const pid of providers) {
                  const available = await modelRuntime.getAvailable(pid);
                  if (available.length > 0) {
                    resolvedModel = available[0];
                    console.log("[Cagent] Using model:", resolvedModel.provider, resolvedModel.id);
                    break;
                  }
                }
              }
              if (!resolvedModel) {
                ws.send(JSON.stringify({ type: "error", payload: { message: "没有可用模型，请检查 API Key 是否正确" } }));
                return;
              }
              // Model changed, need new agent session
              agentSession = null;
            }

            // Reuse agent session if already created (recreate if cwd changed)
            const targetCwd = payload.cwd || process.cwd();
            if (!agentSession || agentSession._cwd !== targetCwd) {
              console.log("[Cagent] Creating agent session... cwd:", targetCwd);
              const { session } = await pi.createAgentSession({
                sessionManager,
                modelRuntime,
                model: resolvedModel,
                cwd: targetCwd,
              });
              session._cwd = targetCwd;
              agentSession = session;
              console.log("[Cagent] Agent session created");
            }
            currentSession = agentSession;

            // Build images array from payload
            const images = (payload.images || []).map(img => ({
              type: "image",
              data: img.data,
              mimeType: img.mimeType || "image/png",
            }));

            // Send a thinking indicator
            ws.send(JSON.stringify({ type: "token", payload: { text: "" } }));

            // Create AbortController for this prompt (no hard timeout — let pi decide)
            abortCtrl = new AbortController();

            let currentToolName = "";
            let anyOutput = false;

            // Subscribe to session events to capture tokens, tool calls, and results
            const unsub = agentSession.subscribe((event) => {
              try {
                if (ws.readyState !== WebSocket.OPEN) return;

                // Handle message_update events (streaming LLM output)
                if (event.type === "message_update" && event.assistantMessageEvent) {
                  const ev = event.assistantMessageEvent;
                  // Text streaming
                  if (ev.type === "text_delta" && ev.delta) {
                    anyOutput = true;
                    ws.send(JSON.stringify({ type: "token", payload: { text: ev.delta } }));
                    return;
                  }
                  // Thinking/reasoning streaming (also counts as output)
                  if (ev.type === "thinking_delta" && ev.delta) {
                    anyOutput = true;
                    ws.send(JSON.stringify({ type: "token", payload: { text: ev.delta } }));
                    return;
                  }
                  // Tool call streaming
                  if (ev.type === "toolcall_start") {
                    anyOutput = true;
                    currentToolName = ev.toolName || "tool";
                    ws.send(JSON.stringify({
                      type: "tool:call",
                      payload: { name: currentToolName, params: "(streaming...)" },
                    }));
                    return;
                  }
                  // text_start, thinking_start, text_end, thinking_end, toolcall_delta, toolcall_end
                  // Also count any message_update as output (catches edge cases)
                  anyOutput = true;
                  return;
                }

                // Handle tool execution events
                if (event.type === "tool_execution_start") {
                  anyOutput = true;
                  currentToolName = event.toolName || "tool";
                  ws.send(JSON.stringify({
                    type: "tool:call",
                    payload: { name: currentToolName, params: JSON.stringify(event.args || {}, null, 2) },
                  }));
                  return;
                }

                if (event.type === "tool_execution_end") {
                  const output = event.result?.content
                    ? (Array.isArray(event.result.content)
                      ? event.result.content.map(c => c.type === "text" ? c.text : "").join("\n")
                      : String(event.result.content))
                    : "";
                  const truncated = output.length > 8000
                    ? output.slice(0, 8000) + "\n... [truncated]"
                    : output;
                  ws.send(JSON.stringify({
                    type: "tool:result",
                    payload: { name: event.toolName || currentToolName, output: truncated },
                  }));
                  return;
                }

                // message_start for assistant role also counts as output
                if (event.type === "message_start" && event.message?.role === "assistant") {
                  anyOutput = true;
                  return;
                }
              } catch (e) {
                console.log("[Cagent] subscribe callback error:", e.message);
              }
            });

            await agentSession.prompt(payload.text, {
              images: images.length > 0 ? images : undefined,
              signal: abortCtrl.signal,
            });

            unsub();

            if (!anyOutput) {
              ws.send(JSON.stringify({ type: "error", payload: { message: "模型未返回任何内容，请检查 API Key 是否正确，或切换模型后重试" } }));
            }
            ws.send(JSON.stringify({ type: "message:done", payload: {} }));
          } catch (err) {
            console.error("[Cagent] prompt error full:", err);
            console.log("[Cagent] prompt error:", err.name, err.message);
            console.log("[Cagent] prompt error stack:", err.stack?.slice(0, 500));
            if (err.name === "AbortError") {
              ws.send(JSON.stringify({ type: "message:aborted", payload: {} }));
            } else {
              ws.send(JSON.stringify({ type: "error", payload: { message: err.message || String(err) } }));
            }
          }
          break;
        }

        case "session:abort": {
          if (abortCtrl) {
            abortCtrl.abort();
            abortCtrl = null;
          }
          if (currentSession) {
            currentSession.abort().catch(() => {});
          }
          break;
        }

        case "auth:set-key": {
          const provider = payload?.provider || "anthropic";
          const apiKey = payload?.apiKey;
          console.log("[Cagent] auth:set-key received for:", provider);
          if (!modelRuntime) {
            ws.send(JSON.stringify({ type: "error", payload: { message: "未初始化" } }));
            return;
          }
          try {
            // Check if provider exists, if not try to register
            const registered = getProviderIds(modelRuntime);
            console.log("[Cagent] Registered providers:", registered);
            if (!registered.includes(provider)) {
              console.log("[Cagent] Provider not found:", provider);
              ws.send(JSON.stringify({ type: "error", payload: { message: `未知提供商: ${provider}，可用: ${registered.join(", ")}` } }));
              return;
            }
            await modelRuntime.setRuntimeApiKey(provider, apiKey);
            console.log("[Cagent] API key set, refreshing models...");
            const available = await modelRuntime.getAvailable(provider);
            console.log("[Cagent] Available models:", available.map(m => m.id).join(", "));
            if (available.length === 0) {
              ws.send(JSON.stringify({ type: "error", payload: { message: `无法获取 ${provider} 的模型列表，请检查 API Key 是否正确` } }));
            } else {
              ws.send(JSON.stringify({ type: "auth:key-ready", payload: { provider, models: available.map(m => m.id) } }));
              resolvedModel = available[0];
              agentSession = null; // Reset so next prompt recreates session with new key
            }
          } catch (err) {
            console.log("[Cagent] auth:set-key error:", err.message);
            ws.send(JSON.stringify({ type: "error", payload: { message: err.message } }));
          }
          break;
        }

        case "auth:providers": {
          if (modelRuntime) {
            const providers = getProviderIds(modelRuntime);
            ws.send(JSON.stringify({ type: "auth:providers", payload: providers }));
            await sendConfiguredProviderStates(ws, modelRuntime, providers);
          } else {
            // Before init, just return the common ones
            ws.send(JSON.stringify({ type: "auth:providers", payload: ["anthropic", "openai"] }));
          }
          break;
        }

        case "auth:status": {
          const states = getProviderIds(modelRuntime).map((provider) => {
            const status = modelRuntime.getProviderAuthStatus?.(provider);
            return { provider, configured: Boolean(status?.configured), source: status?.source || "pi", models: [] };
          });
          for (const state of states) { try { state.models = (await modelRuntime.getAvailable(state.provider)).map(m => m.id); } catch (err) { state.error = err.message; } }
          ws.send(JSON.stringify({ type: "auth:status", payload: states }));
          break;
        }

        case "auth:clear":
          ws.send(JSON.stringify({ type: "auth:unsupported", payload: { provider: payload?.provider, action: "clear", reason: "pi 0.81.1 未提供 clearRuntimeApiKey RPC" } }));
          break;

        case "mcp:list":
          ws.send(JSON.stringify({ type: "mcp:list", payload: discoverMcp() }));
          break;

        case "mcp:reconnect":
          ws.send(JSON.stringify({ type: "mcp:unsupported", payload: { reason: "pi 0.81.1 未导出 MCP reconnect RPC" } }));
          ws.send(JSON.stringify({ type: "mcp:list", payload: discoverMcp() }));
          break;

        case "session:list": {
          ws.send(JSON.stringify({ type: "session:list", payload: [] }));
          break;
        }

        default:
          ws.send(JSON.stringify({ type: "error", payload: { message: `未知消息类型: ${type}` } }));
      }
    } catch (err) {
      console.log("[Cagent] message parse error:", err.message);
      ws.send(JSON.stringify({ type: "error", payload: { message: err.message } }));
    }
  });

  ws.on("close", () => {
    console.log("[Cagent] Client disconnected");
    if (abortCtrl) {
      abortCtrl.abort();
      abortCtrl = null;
    }
    currentSession?.abort().catch(() => {});
  });
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", name: "Cagent" });
});

httpServer.listen(PORT, () => {
  console.log(`[Cagent] Server running on http://localhost:${PORT}`);
  if (process.send) process.send("ready");
});
