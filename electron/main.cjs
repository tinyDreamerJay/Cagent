const { app, BrowserWindow, shell, ipcMain, screen } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const { spawn } = require("child_process");
const { mergeProviderStates, openAuthUrl } = require("./auth-management.cjs");

// Suppress EPIPE errors when running with piped stdio
process.stdout.on("error", () => {});
process.stderr.on("error", () => {});

const isDev = !app.isPackaged;
const CLIENT_PORT = 5173;

// Chromium GPU failures on Windows can leave an otherwise healthy renderer black.
// This app does not depend on GPU rendering, so prefer a stable software path.
if (process.platform === "win32") {
  app.disableHardwareAcceleration();
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

let mainWindow = null;
let piProcess = null;
let piStdoutBuffer = "";
let piRequestId = 0;
let piReady = false;
let availableModels = [];
const runtimeApiKeys = new Map();
let restartingPi = false;
const pendingPiRequests = new Map();
let pendingGuiMessages = { steering: [], followUp: [] };
let authRuntime = null;
const authPrompts = new Map();
async function getAuthRuntime() {
  if (!authRuntime) {
    const pi = await import("@earendil-works/pi-coding-agent");
    authRuntime = await pi.ModelRuntime.create({ allowModelNetwork: false });
  }
  return authRuntime;
}

function rejectPendingPiRequests(error) {
  for (const pending of pendingPiRequests.values()) {
    clearTimeout(pending.timeout);
    pending.reject(error);
  }
  pendingPiRequests.clear();
}

function loadCcswitchCodexConfig() {
  try {
    const codexDir = path.join(os.homedir(), ".codex");
    const text = fs.readFileSync(path.join(codexDir, "config.toml"), "utf8");
    const providerId = text.match(/^model_provider\s*=\s*["']([^"']+)["']/m)?.[1];
    const modelId = text.match(/^model\s*=\s*["']([^"']+)["']/m)?.[1];
    if (!providerId || !modelId) return null;
    const escaped = providerId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const section = text.match(new RegExp(`\\[model_providers\\.${escaped}\\]([\\s\\S]*?)(?=\\n\\[|$)`))?.[1] || "";
    const baseUrl = section.match(/^base_url\s*=\s*["']([^"']+)["']/m)?.[1];
    const wireApi = section.match(/^wire_api\s*=\s*["']([^"']+)["']/m)?.[1] || "responses";
    const auth = JSON.parse(fs.readFileSync(path.join(codexDir, "auth.json"), "utf8"));
    const apiKey = auth.OPENAI_API_KEY || auth.api_key;
    return baseUrl && apiKey ? { providerId, modelId, baseUrl, wireApi, apiKey } : null;
  } catch {
    return null;
  }
}

function sendToRenderer(type, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("pi:event", { type, payload });
  }
}

function sendPiCommand(command) {
  const child = piProcess;
  const stdin = child?.stdin;
  if (!child || !stdin || stdin.destroyed || !stdin.writable || child.exitCode !== null) {
    return Promise.reject(new Error("pi RPC is not running"));
  }
  const id = `cagent-${++piRequestId}`;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingPiRequests.delete(id);
      reject(new Error(`pi RPC timed out: ${command.type}`));
    }, 30000);
    pendingPiRequests.set(id, { resolve, reject, timeout });
    const failWrite = (error) => {
      const pending = pendingPiRequests.get(id);
      if (!pending) return;
      pendingPiRequests.delete(id);
      clearTimeout(pending.timeout);
      pending.reject(error instanceof Error ? error : new Error(String(error)));
    };
    try {
      stdin.write(`${JSON.stringify({ ...command, id })}\n`, (error) => {
        if (error) failWrite(error);
      });
    } catch (error) {
      failWrite(error);
    }
  });
}

function providerEnvName(provider) {
  const normalized = String(provider || "").toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return normalized ? `${normalized}_API_KEY` : null;
}

function toolResultText(result) {
  const content = result?.content;
  if (!Array.isArray(content)) return content ? String(content) : "";
  return content.map((item) => item?.type === "text" ? item.text : "").filter(Boolean).join("\n");
}

function messageContentText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (typeof item === "string") return item;
      if (item?.type === "text") return item.text || "";
      if (item?.type === "thinking") return item.thinking || "";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function toRendererMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((message) => message?.role === "user" || message?.role === "assistant")
    .map((message, index) => ({
      id: message.id || `pi-${message.role}-${index}`,
      role: message.role,
      text: messageContentText(message),
    }));
}

async function listPiSessions() {
  const piModule = await import(pathToFileURL(path.join(__dirname, "..", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "index.js")).href);
  const sessions = await piModule.SessionManager.list(currentCwd);
  return sessions.map((session) => ({
    id: session.path,
    path: session.path,
    name: session.name || session.firstMessage || "New session",
    createdAt: session.created?.getTime?.() || 0,
    updatedAt: session.modified?.getTime?.() || 0,
    messageCount: session.messageCount || 0,
  }));
}

async function publishPiSessions() {
  const sessions = await listPiSessions();
  sendToRenderer("session:list", sessions);
  return sessions;
}

async function publishPiMessages() {
  const result = await sendPiCommand({ type: "get_messages" });
  sendToRenderer("session:messages", toRendererMessages(result?.messages));
}

function handlePiEvent(event) {
  if (event.type === "message_update") {
    const delta = event.assistantMessageEvent;
    if (delta?.type === "text_delta" && delta.delta) {
      sendToRenderer("token", { text: delta.delta });
    } else if (delta?.type === "thinking_delta" && delta.delta) {
      sendToRenderer("thinking:delta", { text: delta.delta });
    }
  } else if (event.type === "tool_execution_start") {
    sendToRenderer("tool:call", { id: event.toolCallId, name: event.toolName || "tool", params: event.args || {} });
  } else if (event.type === "tool_execution_update") {
    sendToRenderer("tool:update", { id: event.toolCallId, name: event.toolName || "tool", output: toolResultText(event.partialResult) });
  } else if (event.type === "tool_execution_end") {
    sendToRenderer("tool:result", { id: event.toolCallId, name: event.toolName || "tool", output: toolResultText(event.result), isError: Boolean(event.isError) });
  } else if (event.type === "agent_settled") {
    pendingGuiMessages = { steering: [], followUp: [] };
    sendToRenderer("session:queue", pendingGuiMessages);
    sendToRenderer("message:done", {});
  } else if (event.type === "agent_end") {
    const lastAssistant = [...(event.messages || [])].reverse().find((message) => message?.role === "assistant");
    const errorMessage = lastAssistant?.errorMessage;
    if (errorMessage && !event.willRetry) {
      sendToRenderer("error", { message: errorMessage });
      sendToRenderer("message:done", {});
    }
  } else if (event.type === "auto_retry_start") {
    sendToRenderer("status", { message: `Retrying model request (${event.attempt}/${event.maxAttempts})...` });
  } else if (event.type === "auto_retry_end") {
    if (!event.success && event.finalError) {
      sendToRenderer("error", { message: event.finalError });
      sendToRenderer("message:done", {});
    }
  } else if (event.type === "extension_ui_request") {
    sendToRenderer("pi:extension-ui", event);
  } else {
    sendToRenderer("pi:event", event);
  }
}

function handlePiLine(line) {
  if (!line.trim()) return;
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.type === "response" && message.id && pendingPiRequests.has(message.id)) {
    const pending = pendingPiRequests.get(message.id);
    pendingPiRequests.delete(message.id);
    clearTimeout(pending.timeout);
    if (message.success) pending.resolve(message.data);
    else pending.reject(new Error(message.error || `pi command failed: ${message.command}`));
    return;
  }
  handlePiEvent(message);
}

let currentCwd = process.cwd();

function startPiRpc(cwd) {
  cwd = cwd || currentCwd;
  currentCwd = cwd;
  return new Promise((resolve, reject) => {
    const rpcEntry = path.join(__dirname, "..", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "rpc-entry.js");
    const ccswitchExt = path.join(__dirname, "ccswitch-provider.cjs");
    const deepseekExt = path.join(__dirname, "deepseek-provider.cjs");
    const ccswitch = loadCcswitchCodexConfig();
    if (ccswitch && !runtimeApiKeys.has(ccswitch.providerId)) {
      runtimeApiKeys.set(ccswitch.providerId, ccswitch.apiKey);
    }
    const args = [rpcEntry, "--extension", deepseekExt];
    if (ccswitch) args.push("--extension", ccswitchExt);
    const childEnv = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      // Pi requires either a literal apiKey or a populated env-var for checkAuth.
      // Set a sentinel so deepseek models appear in get_available_models even
      // before the user enters a real API key. The actual key is provided later
      // via auth:set-key (which restarts the RPC child with the real value).
      CAGENT_DEEPSEEK_API_KEY: "1",
    };
    if (ccswitch) {
      childEnv.CAGENT_CCSWITCH_PROVIDER = ccswitch.providerId;
      childEnv.CAGENT_CCSWITCH_BASE_URL = ccswitch.baseUrl;
      childEnv.CAGENT_CCSWITCH_API_KEY = runtimeApiKeys.get(ccswitch.providerId) || ccswitch.apiKey;
      childEnv.CAGENT_CCSWITCH_MODEL = ccswitch.modelId;
      childEnv.CAGENT_CCSWITCH_WIRE_API = ccswitch.wireApi;
    }
    for (const [provider, apiKey] of runtimeApiKeys) {
      const envName = providerEnvName(provider);
      if (envName) childEnv[envName] = apiKey;
      // deepseek-provider.cjs references $CAGENT_DEEPSEEK_API_KEY
      if (provider === "deepseek") childEnv.CAGENT_DEEPSEEK_API_KEY = apiKey;
    }
    const child = spawn(process.execPath, args, {
      cwd: cwd,
      env: childEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });
    piProcess = child;
    child.stdout.on("data", (chunk) => {
      piStdoutBuffer += chunk.toString();
      const lines = piStdoutBuffer.split("\n");
      piStdoutBuffer = lines.pop() || "";
      for (const line of lines) handlePiLine(line.endsWith("\r") ? line.slice(0, -1) : line);
    });
    child.stderr.on("data", (d) => console.error("[pi:err]", d.toString().trim()));
    child.stdin.on("error", (error) => {
      if (piProcess !== child) return;
      piReady = false;
      const rpcError = new Error(`pi RPC input closed: ${error.message}`);
      rejectPendingPiRequests(rpcError);
      if (!restartingPi) sendToRenderer("error", { message: rpcError.message });
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (piProcess !== child) return;
      piReady = false;
      const error = new Error(`pi RPC exited (code=${code}, signal=${signal})`);
      rejectPendingPiRequests(error);
      if (!restartingPi) sendToRenderer("error", { message: error.message });
    });
    setTimeout(async () => {
      try {
        await sendPiCommand({ type: "get_state" });
        piReady = true;
        resolve();
      } catch (error) { reject(error); }
    }, 200);
  });
}

function stopPiRpc() {
  if (piProcess) {
    piProcess.kill();
    piProcess = null;
  }
}

async function initializeRendererSession() {
  const state = await sendPiCommand({ type: "get_state" });
  const result = await sendPiCommand({ type: "get_available_models" });
  availableModels = result?.models || [];
  sendToRenderer("session:ready", { sessionId: state?.sessionId, sessionFile: state?.sessionFile, cwd: currentCwd });
  const providers = [...new Set(availableModels.map((model) => model.provider))];
  sendToRenderer("auth:providers", providers);
  // 为每个有模型的 provider 都发送 auth:key-ready，让前端看到所有可用模型
  const providersWithModels = new Map();
  for (const model of availableModels) {
    if (!providersWithModels.has(model.provider)) {
      providersWithModels.set(model.provider, []);
    }
    providersWithModels.get(model.provider).push(model.id);
  }
  for (const [provider, models] of providersWithModels) {
    // DeepSeek's sentinel exposes its models before a user enters a key. It is
    // not a real credential and must not make the renderer select DeepSeek.
    if (runtimeApiKeys.has(provider)) {
      sendToRenderer("auth:key-ready", { provider, models, source: "pi" });
    }
  }
  await publishSessionState(state);
  await publishPiMessages();
  await publishPiSessions();
  return availableModels;
}

async function publishSessionState(state) {
  const currentState = state || await sendPiCommand({ type: "get_state" });
  const levels = await sendPiCommand({ type: "get_available_thinking_levels" });
  sendToRenderer("session:state", { ...currentState, cwd: currentCwd });
  sendToRenderer("session:queue", pendingGuiMessages);
  sendToRenderer("session:thinking-levels", levels?.levels || []);
  return currentState;
}

async function publishRendererAuthState() {
  const result = await sendPiCommand({ type: "get_available_models" });
  availableModels = result?.models || [];
  const providersWithModels = new Map();
  for (const model of availableModels) {
    if (!providersWithModels.has(model.provider)) {
      providersWithModels.set(model.provider, []);
    }
    providersWithModels.get(model.provider).push(model.id);
  }
  for (const [provider, models] of providersWithModels) {
    sendToRenderer("auth:key-ready", { provider, models, source: "pi" });
  }
  return availableModels;
}

async function publishProviderStatus() {
  const models = await publishRendererAuthState();
  const runtime = await getAuthRuntime();
  const stored = new Map((await runtime.listCredentials()).map((item) => [item.providerId, item.type]));
  const states = runtime.getProviders().map((providerInfo) => {
    const provider = providerInfo.id;
    const providerModels = models.filter((model) => model.provider === provider).map((model) => model.id);
    const envName = providerEnvName(provider);
    const auth = providerInfo.auth || {};
    const configured = stored.has(provider) || runtimeApiKeys.has(provider) || Boolean(process.env[envName]);
    return { provider, configured, available: providerModels.length > 0, source: stored.has(provider) ? `stored:${stored.get(provider)}` : (runtimeApiKeys.has(provider) ? "runtime" : (process.env[envName] ? "environment" : "catalog")), capabilities: { apiKey: Boolean(auth.apiKey), oauth: Boolean(auth.oauth) }, models: providerModels };
  });
  const merged = mergeProviderStates(runtime.getProviders(), models, stored, runtimeApiKeys, new Set());
  sendToRenderer("auth:status", merged);
  return merged;
}

ipcMain.on("pi:command", async (_event, message) => {
  try {
    const payload = message?.payload || {};
    if (message?.type === "session:init") return await initializeRendererSession();
    if (message?.type === "session:prompt") {
      if (payload.model) {
        // 优先使用 payload 携带的 provider，否则从 availableModels 查找
        const provider = payload.provider || availableModels.find((item) => item.id === payload.model)?.provider;
        if (provider) await sendPiCommand({ type: "set_model", provider, modelId: payload.model });
      }
      return await sendPiCommand({ type: "prompt", message: payload.text || "", images: payload.images });
    }
    if (message?.type === "session:steer") {
      await sendPiCommand({ type: "steer", message: payload.text || "", images: payload.images });
      pendingGuiMessages.steering.push(String(payload.text || ""));
      sendToRenderer("session:queue", pendingGuiMessages);
      await publishSessionState();
      return;
    }
    if (message?.type === "session:follow-up") {
      await sendPiCommand({ type: "follow_up", message: payload.text || "", images: payload.images });
      pendingGuiMessages.followUp.push(String(payload.text || ""));
      sendToRenderer("session:queue", pendingGuiMessages);
      await publishSessionState();
      return;
    }
    if (message?.type === "session:abort") return await sendPiCommand({ type: "abort" });
    if (message?.type === "session:new") {
      const result = await sendPiCommand({ type: "new_session" });
      if (!result?.cancelled) {
        pendingGuiMessages = { steering: [], followUp: [] };
        await initializeRendererSession();
      }
      return;
    }
    if (message?.type === "session:set-thinking") {
      await sendPiCommand({ type: "set_thinking_level", level: payload.level });
      await publishSessionState();
      return;
    }
    if (message?.type === "session:set-auto-compaction") {
      await sendPiCommand({ type: "set_auto_compaction", enabled: Boolean(payload.enabled) });
      await publishSessionState();
      return;
    }
    if (message?.type === "session:set-auto-retry") {
      await sendPiCommand({ type: "set_auto_retry", enabled: Boolean(payload.enabled) });
      await publishSessionState();
      return;
    }
    if (message?.type === "session:abort-retry") return await sendPiCommand({ type: "abort_retry" });
    if (message?.type === "session:set-steering-mode") {
      await sendPiCommand({ type: "set_steering_mode", mode: payload.mode });
      await publishSessionState();
      return;
    }
    if (message?.type === "session:set-follow-up-mode") {
      await sendPiCommand({ type: "set_follow_up_mode", mode: payload.mode });
      await publishSessionState();
      return;
    }
    if (message?.type === "session:compact") {
      sendToRenderer("status", { message: "Compacting context..." });
      try {
        await sendPiCommand({ type: "compact" });
      } finally {
        sendToRenderer("status", { message: "" });
      }
      await publishSessionState();
      return;
    }
    if (message?.type === "session:stats") {
      const stats = await sendPiCommand({ type: "get_session_stats" });
      sendToRenderer("session:stats", stats || {});
      return;
    }
    if (message?.type === "session:commands") {
      const result = await sendPiCommand({ type: "get_commands" });
      sendToRenderer("session:commands", result?.commands || []);
      return;
    }
    if (message?.type === "session:tree") {
      const result = await sendPiCommand({ type: "get_tree" });
      sendToRenderer("session:tree", result || { tree: [], leafId: null });
      return;
    }
    if (message?.type === "session:fork-messages") {
      const result = await sendPiCommand({ type: "get_fork_messages" });
      sendToRenderer("session:fork-messages", result?.messages || []);
      return;
    }
    if (message?.type === "session:entries") {
      const result = await sendPiCommand({ type: "get_entries", since: payload.since });
      sendToRenderer("session:entries", result || { entries: [], leafId: null });
      return;
    }
    if (message?.type === "session:fork") {
      const result = await sendPiCommand({ type: "fork", entryId: payload.entryId });
      if (!result?.cancelled) {
        pendingGuiMessages = { steering: [], followUp: [] };
        await initializeRendererSession();
      }
      return;
    }
    if (message?.type === "session:clone") {
      const result = await sendPiCommand({ type: "clone" });
      if (!result?.cancelled) {
        pendingGuiMessages = { steering: [], followUp: [] };
        await initializeRendererSession();
      }
      return;
    }
    if (message?.type === "session:set-name") {
      await sendPiCommand({ type: "set_session_name", name: String(payload.name || "") });
      await initializeRendererSession();
      return;
    }
    if (message?.type === "session:export-html") {
      const result = await sendPiCommand({ type: "export_html", outputPath: payload.outputPath || undefined });
      sendToRenderer("session:exported", result || {});
      return;
    }
    if (message?.type === "session:bash") {
      const result = await sendPiCommand({ type: "bash", command: String(payload.command || ""), excludeFromContext: Boolean(payload.excludeFromContext) });
      sendToRenderer("session:bash-result", result || {});
      return;
    }
    if (message?.type === "session:abort-bash") return await sendPiCommand({ type: "abort_bash" });
    if (message?.type === "extension:respond") {
      return await sendPiCommand({ type: "extension_ui_response", ...payload });
    }
    if (message?.type === "session:set-cwd") {
      const newCwd = String(payload.cwd || "").trim();
      if (!newCwd) throw new Error("cwd 不能为空");
      if (!fs.existsSync(newCwd)) throw new Error(`目录不存在: ${newCwd}`);
      if (newCwd === currentCwd) return;
      restartingPi = true;
      stopPiRpc();
      try {
        await startPiRpc(newCwd);
        await initializeRendererSession();
      } finally {
        restartingPi = false;
      }
      sendToRenderer("cwd:updated", { cwd: newCwd });
      return;
    }
    if (message?.type === "session:list") return await publishPiSessions();
    if (message?.type === "session:switch") {
      const sessionPath = String(payload.path || "");
      const sessions = await listPiSessions();
      if (!sessions.some((session) => session.path === sessionPath)) {
        throw new Error("The selected pi session is not available in the current project");
      }
      const result = await sendPiCommand({ type: "switch_session", sessionPath });
      if (!result?.cancelled) {
        pendingGuiMessages = { steering: [], followUp: [] };
        await initializeRendererSession();
      }
      return;
    }
    if (message?.type === "auth:providers") return await initializeRendererSession();
    if (message?.type === "auth:status") return await publishProviderStatus();
    if (message?.type === "mcp:list") {
      sendToRenderer("mcp:list", [{ status: "unsupported", source: "pi 0.81.1", error: "pi 0.81.1 文档明确不包含 built-in MCP，RPC 也无 MCP 事件或工具列表" }]);
      return;
    }
    if (message?.type === "auth:oauth") {
      const runtime = await getAuthRuntime();
      sendToRenderer("auth:oauth-status", { status: "starting", provider: payload.provider, message: "正在启动 pi OAuth 登录" });
      await runtime.login(String(payload.provider), "oauth", { notify: (event) => { if (event.type === "auth_url" || event.type === "device_code") openAuthUrl(event, shell.openExternal); sendToRenderer("auth:oauth-event", { provider: payload.provider, event }); }, prompt: (prompt) => new Promise((resolve, reject) => { const id = `auth-${Date.now()}-${Math.random()}`; authPrompts.set(id, { resolve, reject }); sendToRenderer("auth:oauth-prompt", { id, provider: payload.provider, prompt }); }) });
      sendToRenderer("auth:oauth-status", { status: "complete", provider: payload.provider, message: "OAuth 登录完成，凭据已保存到 pi auth store" });
      restartingPi = true;
      try { stopPiRpc(); await startPiRpc(); await initializeRendererSession(); } finally { restartingPi = false; }
      await publishProviderStatus();
      return;
    }
    if (message?.type === "auth:prompt-response") { const pending = authPrompts.get(payload.id); if (!pending) throw new Error("unknown or replayed auth prompt"); authPrompts.delete(payload.id); if (payload.cancelled) pending.reject(new Error("Authentication cancelled")); else pending.resolve(String(payload.value || "")); return; }
    if (message?.type === "auth:clear") {
      const runtime = await getAuthRuntime();
      const provider = String(payload.provider);
      if ((await runtime.listCredentials()).some((item) => item.providerId === provider)) await runtime.logout(provider);
      if (runtimeApiKeys.has(provider)) { await runtime.removeRuntimeApiKey(provider); runtimeApiKeys.delete(provider); }
      restartingPi = true; const old = piProcess; stopPiRpc(); try { await startPiRpc(); await initializeRendererSession(); } finally { restartingPi = false; }
      await publishProviderStatus();
      return;
    }
    if (message?.type === "auth:set-key") {
      const provider = String(payload.provider || "").trim();
      const apiKey = String(payload.apiKey || "").trim();
      if (!provider || !apiKey) throw new Error("provider 和 API Key 不能为空");
      if (payload.mode === "stored") {
        const runtime = await getAuthRuntime();
        await runtime.login(provider, "api_key", { prompt: async () => apiKey, notify: (event) => sendToRenderer("auth:oauth-event", { provider, event }) });
      }
      if (runtimeApiKeys.get(provider) === apiKey) {
        const models = await publishProviderStatus();
        if (!models.length) sendToRenderer("error", { message: `无法从 ${provider} 获取可用模型，请检查 API Key` });
        return;
      }

      runtimeApiKeys.set(provider, apiKey);
      restartingPi = true;
      stopPiRpc();
      try {
        await startPiRpc();
      } finally {
        restartingPi = false;
      }
      const models = await publishProviderStatus();
      if (!models.length) sendToRenderer("error", { message: `无法从 ${provider} 获取可用模型，请检查 API Key` });
      return;
    }
  } catch (error) {
    sendToRenderer("error", { message: error?.message || String(error) });
  }
});

async function createWindow() {
  const { width: workWidth, height: workHeight } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: Math.min(1200, Math.max(680, workWidth - 48)),
    height: Math.min(800, Math.max(400, workHeight - 48)),
    minWidth: 680,
    minHeight: 400,
    center: true,
    title: "Cagent",
    backgroundColor: "#0d0d0d",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level >= 2) {
      console.error(`[renderer] ${message} (${sourceId}:${line})`);
    }
  });
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame) {
      console.error(`[Cagent] Failed to load ${validatedURL}: ${errorCode} ${errorDescription}`);
    }
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[Cagent] Renderer process gone:", details);
    if (!mainWindow || mainWindow.isDestroyed()) return;
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
    }, 250);
  });
  mainWindow.webContents.on("unresponsive", () => {
    console.error("[Cagent] Renderer became unresponsive");
  });

  const showLoadError = (err) => {
    console.error("[Cagent] Window load error:", err);
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const message = String(err?.message || err).replace(/[<>&]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[ch]));
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
      <html><body style="background:#0d0d0d;color:#eee;font:14px system-ui;padding:32px">
        <h2>Cagent could not load the interface</h2><p>${message}</p><p>Close the window and start the app again.</p>
      </body></html>
    `)}`);
  };

  try {
    if (isDev) {
      await mainWindow.loadURL(`http://localhost:${CLIENT_PORT}`);
    } else {
      await mainWindow.loadFile(path.join(__dirname, "..", "client", "dist", "index.html"));
    }
    if (isDev && process.env.CAGENT_DEVTOOLS === "1") {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  } catch (err) {
    showLoadError(err);
  }

  mainWindow.on("closed", () => { mainWindow = null; });
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.on("child-process-gone", (_event, details) => {
    if (details.type === "GPU" || details.type === "GPU_PROCESS") {
      console.error("[Cagent] GPU process gone:", details);
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
    }
  });

  app.whenReady().then(async () => {
    try {
      console.log("[Cagent] Starting pi RPC...");
      await startPiRpc();
      console.log("[Cagent] pi RPC ready, creating window...");
      await createWindow();
    } catch (err) {
      console.error("[Cagent] Failed to start:", err);
      app.quit();
    }
  });

  app.on("window-all-closed", () => {
    stopPiRpc();
    app.quit();
  });

  app.on("before-quit", stopPiRpc);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
