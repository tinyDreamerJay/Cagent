import express from "express";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import { CagentSession } from "./session.js";

const app = express();
app.use(cors());
app.use(express.json());

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

function registerDeepSeekProvider(rt: any) {
  rt.registerProvider("deepseek", {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
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
          await currentSession.prompt(payload.text, { modelId: payload.model, images: payload.images });
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
            const providers = modelRuntime.getRegisteredProviderIds();
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
            const registered = modelRuntime.getRegisteredProviderIds();
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
            const providers = modelRuntime.getRegisteredProviderIds();
            ws.send(JSON.stringify({ type: "auth:providers", payload: providers }));
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

const PORT = process.env.PORT || 4120;
server.listen(PORT, () => {
  console.log(`[Cagent] Server running on http://localhost:${PORT}`);
});
