import express from "express";
import cors from "cors";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import { CagentSession } from "./session.js";

const app = express();
app.use(cors());
app.use(express.json());

type PiResource = { kind: string; name: string; source: string; path: string; status: "active" | "error"; error?: string };
function scanResources(): PiResource[] {
  const home = os.homedir();
  const roots: Array<[string,string]> = [["skills", path.join(home, ".pi", "agent", "skills")], ["prompts", path.join(home, ".pi", "agent", "prompts")], ["extensions", path.join(home, ".pi", "agent", "extensions")], ["commands", path.join(home, ".pi", "agent", "commands")]];
  const out: PiResource[] = [];
  for (const [kind, root] of roots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const full = path.join(root, entry.name);
      try { out.push({ kind, name: entry.name, source: "user", path: full, status: "active" }); }
      catch (e: any) { out.push({ kind, name: entry.name, source: "user", path: full, status: "error", error: e.message }); }
    }
  }
  return out;
}
function resourceCapabilities() { return { reload: false, enable: false, disable: false, open: true, note: "pi 0.81.1 does not expose resource lifecycle RPC; resources reload on next session." }; }

const server = createServer(app);
const wss = new WebSocketServer({ server });

// Module-level singletons (not per-session)
let modelRuntime: any = null;
let sessionManager: any = null;

// Lazy-loaded pi SDK
let piSDK: any = null;
async function getPiSDK() {
  if (!piSDK) {
    piSDK = await import("@earendil-works/pi-coding-agent");
  }
  return piSDK;
}

// ModelRuntime.getRegisteredProviderIds() only contains extension providers.
// Include pi-agent's built-in providers as well (Anthropic, OpenAI, etc.).
function getProviderIds(rt: any): string[] {
  const ids = new Set<string>();
  for (const provider of rt?.getProviders?.() || []) {
    if (provider?.id) ids.add(provider.id);
  }
  for (const id of rt?.getRegisteredProviderIds?.() || []) ids.add(id);
  return [...ids];
}

async function sendConfiguredProviderStates(ws: WebSocket, rt: any, ids: string[]) {
  for (const provider of ids) {
    try {
      const status = rt.getProviderAuthStatus?.(provider);
      if (!status?.configured) continue;
      const models = await rt.getAvailable(provider);
      if (models.length > 0) {
        ws.send(JSON.stringify({
          type: "auth:key-ready",
          payload: { provider, models: models.map((m: any) => m.id), source: status.source },
        }));
      }
    } catch {
      // A provider without usable credentials is still listed and can be configured manually.
    }
  }
}

function loadCcswitchCodexConfig() {
  try {
    const home = os.homedir();
    const configText = fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8");
    const providerId = configText.match(/^model_provider\s*=\s*["']([^"']+)["']/m)?.[1];
    const modelId = configText.match(/^model\s*=\s*["']([^"']+)["']/m)?.[1] || "gpt-5";
    if (!providerId) return null;
    const section = configText.match(new RegExp(`\\[model_providers\\.${providerId.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\]([\\s\\S]*?)(?=\\n\\[|$)`))?.[1] || "";
    const baseUrl = section.match(/^base_url\s*=\s*["']([^"']+)["']/m)?.[1];
    if (!baseUrl) return null;
    let apiKey: string | undefined;
    try {
      const auth = JSON.parse(fs.readFileSync(path.join(home, ".codex", "auth.json"), "utf8"));
      apiKey = auth.OPENAI_API_KEY || auth.api_key;
    } catch { /* auth can still be entered in the UI */ }
    return { providerId, modelId, baseUrl, apiKey, wireApi: section.match(/^wire_api\s*=\s*["']([^"']+)["']/m)?.[1] };
  } catch {
    return null;
  }
}

async function registerCcswitchProvider(rt: any) {
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

function registerDeepSeekProvider(rt: any) {
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
    try {
      registerDeepSeekProvider(modelRuntime);
      await registerCcswitchProvider(modelRuntime);
      console.log("[Cagent] DeepSeek provider registered");
    } catch (err: any) {
      console.log("[Cagent] Failed to register DeepSeek:", err.message);
    }
  }
  return { pi, sessionManager, modelRuntime };
}

// Store active sessions
const sessions = new Map<string, CagentSession>();

wss.on("connection", (ws: WebSocket) => {
  console.log("[Cagent] Client connected");

  let currentSession: CagentSession | null = null;

  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const { type, payload, id } = msg;

      switch (type) {
        case "session:init": {
          await initSession();
          const session = new CagentSession(ws, modelRuntime, sessionManager);
          sessions.set(session.id, session);
          currentSession = session;
          ws.send(JSON.stringify({ type: "session:ready", payload: { sessionId: session.id } }));
          break;
        }

        case "session:prompt": {
          if (!currentSession) {
            ws.send(JSON.stringify({ type: "error", payload: { message: "没有活跃的会话" } }));
            return;
          }
          await currentSession.prompt(payload.text, { modelId: payload.model, images: payload.images, cwd: payload.cwd });
          break;
        }

        case "session:abort": {
          currentSession?.abort();
          break;
        }

        case "session:list": {
          ws.send(JSON.stringify({ type: "session:list", payload: [] }));
          break;
        }

        case "model:list": {
          if (modelRuntime) {
            const providers = getProviderIds(modelRuntime);
            const all: any[] = [];
            for (const pid of providers) {
              const available = await modelRuntime.getAvailable(pid);
              for (const m of available) {
                all.push({ provider: pid, model: m.id });
              }
            }
            ws.send(JSON.stringify({ type: "model:list", payload: all }));
          } else {
            ws.send(JSON.stringify({ type: "model:list", payload: [] }));
          }
          break;
        }

        case "auth:set-key": {
          const { provider, apiKey } = payload || {};
          if (!provider || !apiKey) {
            ws.send(JSON.stringify({ type: "error", payload: { message: "缺少 provider 或 apiKey" } }));
            return;
          }
          if (!modelRuntime) {
            ws.send(JSON.stringify({ type: "error", payload: { message: "未初始化" } }));
            return;
          }
          try {
            // Check if provider is registered
            const registered = getProviderIds(modelRuntime);
            if (!registered.includes(provider)) {
              ws.send(JSON.stringify({ type: "error", payload: { message: `鏈煡鎻愪緵鍟?${provider}，可用: ${registered.join(", ")}` } }));
              return;
            }
            await modelRuntime.setRuntimeApiKey(provider, apiKey);
            const available = await modelRuntime.getAvailable(provider);
            if (available.length === 0) {
              ws.send(JSON.stringify({ type: "error", payload: { message: "无法获取模型列表，请检查 API Key" } }));
            } else {
              ws.send(JSON.stringify({ type: "auth:key-ready", payload: { provider, models: available.map((m: any) => m.id) } }));
            }
          } catch (err: any) {
            ws.send(JSON.stringify({ type: "error", payload: { message: err.message || String(err) } }));
          }
          break;
        }

        case "auth:providers": {
          if (modelRuntime) {
            const providers = getProviderIds(modelRuntime);
            ws.send(JSON.stringify({ type: "auth:providers", payload: providers }));
            await sendConfiguredProviderStates(ws, modelRuntime, providers);
          } else {
            ws.send(JSON.stringify({ type: "auth:providers", payload: ["deepseek"] }));
          }
          break;
        }

        default:
          ws.send(JSON.stringify({ type: "error", payload: { message: `鏈煡娑堟伅绫诲瀷: ${type}` } }));
      }
    } catch (err: any) {
      ws.send(JSON.stringify({ type: "error", payload: { message: err.message || String(err) } }));
    }
  });

  ws.on("close", () => {
    console.log("[Cagent] Client disconnected");
    if (currentSession) {
      sessions.delete(currentSession.id);
    }
  });
});

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", name: "Cagent" });
});
app.get("/api/resources", (_req, res) => res.json({ resources: scanResources(), capabilities: resourceCapabilities() }));
app.get("/api/stats", (_req, res) => res.json({ tokens: { input: 0, output: 0, total: 0 }, cache: { read: 0, write: 0 }, cost: 0, context: { used: 0, limit: 0, percent: 0 }, compaction: { count: 0 }, source: "pi session events" }));
app.post("/api/resources/action", (req, res) => {
  const action = req.body?.action;
  if (action === "open") {
    const target = req.body?.path;
    if (typeof target !== "string" || !fs.existsSync(target)) return res.status(404).json({ ok: false, error: "resource path not found" });
    return res.json({ ok: true, path: target });
  }
  return res.status(409).json({ ok: false, error: `unsupported resource action: ${action}`, capabilities: resourceCapabilities() });
});
app.get("/api/export", (req, res) => {
  const format = req.query.format === "html" ? "html" : "jsonl";
  const data = { exportedAt: new Date().toISOString(), resources: scanResources(), stats: { tokens: { input: 0, output: 0, total: 0 } } };
  if (format === "html") { res.type("html").send(`<html><body><h1>Cagent export</h1><pre>${JSON.stringify(data, null, 2).replace(/</g, "&lt;")}</pre></body></html>`); }
  else { res.type("application/jsonl").send(JSON.stringify(data) + "\n"); }
});
app.post("/api/import", (req, res) => {
  const data = req.body;
  if (!data || typeof data !== "object") return res.status(400).json({ ok: false, error: "invalid import payload" });
  res.json({ ok: true, restored: { resources: Array.isArray(data.resources) ? data.resources.length : 0 }, note: "Resource files are not overwritten; import is metadata-only." });
});

const PORT = process.env.PORT || 4120;
server.listen(PORT, () => {
  console.log(`[Cagent] Server running on http://localhost:${PORT}`);
});
