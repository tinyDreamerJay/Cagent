const { app, BrowserWindow, shell, ipcMain, screen, dialog, Menu } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { pathToFileURL } = require("url");
const { spawn, execFile } = require("child_process");
const {
  addResourcePath,
  assertSessionFile,
  assertWhitelistedResource,
  copyFileVerified,
} = require("./resource-utils.cjs");
const { mergeProviderStates, openAuthUrl } = require("./auth-management.cjs");
const { archiveSessionFile, getProjectArchiveDir, restoreSessionFile } = require("./session-archive.cjs");

// Suppress EPIPE errors when running with piped stdio
process.stdout.on("error", () => {});
process.stderr.on("error", () => {});

const isDev = !app.isPackaged;
const CLIENT_PORT = 5173;

function installChineseMenu() {
  const template = [
    {
      label: "应用",
      submenu: [
        { label: "关于 Cagent", role: "about" },
        { type: "separator" },
        { label: "退出", role: "quit" },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { label: "撤销", role: "undo" },
        { label: "重做", role: "redo" },
        { type: "separator" },
        { label: "剪切", role: "cut" },
        { label: "复制", role: "copy" },
        { label: "粘贴", role: "paste" },
        { label: "全选", role: "selectAll" },
      ],
    },
    {
      label: "视图",
      submenu: [
        { label: "重新加载", role: "reload" },
        { label: "强制重新加载", role: "forceReload" },
        ...(isDev ? [{ label: "开发者工具", role: "toggleDevTools" }] : []),
        { type: "separator" },
        { label: "实际大小", role: "resetZoom" },
        { label: "放大", role: "zoomIn" },
        { label: "缩小", role: "zoomOut" },
        { type: "separator" },
        { label: "全屏", role: "togglefullscreen" },
      ],
    },
    {
      label: "窗口",
      submenu: [
        { label: "最小化", role: "minimize" },
        { label: "关闭", role: "close" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

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
let activeSessionFile = null;
let activeThinkingLevel = "off";
const resourceOpenWhitelist = new Set();
let authRuntime = null;
const authPrompts = new Map();

async function readSessionThinkingLevel(sessionFile) {
  if (!sessionFile || !fs.existsSync(sessionFile)) return "off";
  let level = "off";
  const lines = readline.createInterface({ input: fs.createReadStream(sessionFile, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry?.type === "thinking_level_change" && typeof entry.thinkingLevel === "string") level = entry.thinkingLevel;
    } catch {}
  }
  return level;
}
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
    return Promise.reject(new Error("pi RPC 未运行"));
  }
  const id = `cagent-${++piRequestId}`;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingPiRequests.delete(id);
      reject(new Error(`pi RPC 请求超时：${command.type}`));
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

async function scanPiResources() {
  const pi = await import(pathToFileURL(path.join(__dirname, "..", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "index.js")).href);
  const agentDir = path.join(os.homedir(), ".pi", "agent");
  const loader = new pi.DefaultResourceLoader({ cwd: currentCwd, agentDir, noExtensions: true });
  await loader.reload();
  const resources = [];
  resourceOpenWhitelist.clear();
  const add = (kind, item, name, filePath, status = "available") => {
    let realPath = filePath;
    try {
      realPath = addResourcePath(resourceOpenWhitelist, filePath);
    } catch {
      status = "error";
    }
    resources.push({ kind, name, path: realPath, source: item?.sourceInfo?.scope || item?.sourceInfo?.source || "unknown", status, description: item?.description });
  };
  for (const item of loader.getSkills().skills) add("skill", item, item.name, item.filePath);
  for (const item of loader.getPrompts().prompts) add("prompt", item, item.name, item.filePath);
  const settings = pi.SettingsManager.create(currentCwd, agentDir);
  const packages = new pi.DefaultPackageManager({ cwd: currentCwd, agentDir, settingsManager: settings });
  for (const pkg of packages.listConfiguredPackages()) if (pkg.installedPath) add("extension", { sourceInfo: { scope: pkg.scope, source: pkg.source } }, path.basename(pkg.installedPath), pkg.installedPath, pkg.filtered ? "disabled" : "configured");
  for (const diagnostic of [...loader.getSkills().diagnostics, ...loader.getPrompts().diagnostics]) resources.push({ kind: "resource", name: diagnostic.path || "resource", path: diagnostic.path, source: "unknown", status: "error", error: diagnostic.error || diagnostic.message });
  return resources;
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
  return sessions.map(toSessionSummary);
}

function toSessionSummary(session) {
  return {
    id: session.path,
    path: session.path,
    name: session.name || session.firstMessage || "新会话",
    createdAt: session.created?.getTime?.() || 0,
    updatedAt: session.modified?.getTime?.() || 0,
    messageCount: session.messageCount || 0,
  };
}

async function listArchivedPiSessions() {
  const archiveDir = getProjectArchiveDir(currentCwd);
  if (!fs.existsSync(archiveDir)) return [];
  const piModule = await import(pathToFileURL(path.join(__dirname, "..", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "index.js")).href);
  const sessions = await piModule.SessionManager.list(currentCwd, archiveDir);
  return sessions.map(toSessionSummary);
}

async function publishPiSessions() {
  const [sessions, archivedSessions] = await Promise.all([listPiSessions(), listArchivedPiSessions()]);
  sendToRenderer("session:list", sessions);
  sendToRenderer("session:archives", archivedSessions);
  return sessions;
}

const sessionPathKey = (value) => path.resolve(String(value)).toLowerCase();

async function archivePiSession(sessionPath) {
  const sessions = await listPiSessions();
  const session = sessions.find((item) => sessionPathKey(item.path) === sessionPathKey(sessionPath));
  if (!session) throw new Error("所选会话不属于当前项目或已归档");

  if (activeSessionFile && sessionPathKey(activeSessionFile) === sessionPathKey(session.path)) {
    const result = await sendPiCommand({ type: "new_session" });
    if (result?.cancelled) throw new Error("当前会话仍在运行，暂时无法归档");
  }

  archiveSessionFile(session.path, currentCwd);
  await initializeRendererSession();
}

async function restorePiSession(sessionPath) {
  const archivedSessions = await listArchivedPiSessions();
  const session = archivedSessions.find((item) => sessionPathKey(item.path) === sessionPathKey(sessionPath));
  if (!session) throw new Error("所选归档会话不存在");

  restoreSessionFile(session.path, currentCwd);
  await publishPiSessions();
}

async function publishPiMessages() {
  const result = await sendPiCommand({ type: "get_messages" });
  sendToRenderer("session:messages", toRendererMessages(result?.messages));
}

function publishProviderList() {
  const providers = [...new Set(availableModels.map((model) => model.provider))];
  sendToRenderer("auth:providers", providers);
  return providers;
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
    sendToRenderer("status", { message: `正在重试模型请求（${event.attempt}/${event.maxAttempts}）...` });
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
    else pending.reject(new Error(message.error || `pi 命令执行失败：${message.command}`));
    return;
  }
  handlePiEvent(message);
}

let currentCwd = process.cwd();
const pendingWorkspaceApprovals = new Map();
let terminalSession = null;

function resolveWorkspacePath(input = ".") {
  const root = path.resolve(currentCwd);
  const target = path.resolve(root, String(input));
  const rootReal = fs.realpathSync.native(root);
  let existing = target;
  while (!fs.existsSync(existing)) { const next = path.dirname(existing); if (next === existing) throw new Error("路径无有效父目录"); existing = next; }
  const real = fs.realpathSync.native(existing);
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) throw new Error("路径超出当前工作目录边界");
  return target;
}
function workspaceApproval(action) {
  const id = `approval-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  pendingWorkspaceApprovals.set(id, action);
  sendToRenderer("workspace:approval", { id, type: action.type, summary: action.summary });
  return { approved: false, requiresApproval: true, id, type: action.type, summary: action.summary };
}
function runGit(args) {
  return new Promise((resolve, reject) => execFile("git", args, { cwd: currentCwd, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => error ? reject(new Error(stderr || error.message)) : resolve(stdout)));
}

ipcMain.handle("workspace:request", async (_event, message) => {
  const type = message?.type;
  const p = message?.payload || {};
  if (type === "root") return { cwd: currentCwd };
  if (type === "choose-directory") {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory", "createDirectory"] });
    if (result.canceled || !result.filePaths[0]) return { cancelled: true };
    const selected = path.resolve(result.filePaths[0]);
    const oldCwd = currentCwd; pendingWorkspaceApprovals.clear(); terminalSession?.kill(); terminalSession = null; restartingPi = true; stopPiRpc();
    try { await startPiRpc(selected); await initializeRendererSession(); } catch (error) { stopPiRpc(); await startPiRpc(oldCwd); throw error; } finally { restartingPi = false; }
    sendToRenderer("cwd:updated", { cwd: selected });
    return { cwd: selected };
  }
  if (type === "list") {
    const dir = resolveWorkspacePath(p.path || ".");
    const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => ![".git", "node_modules", "release"].includes(e.name)).sort((a,b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    return { path: path.relative(currentCwd, dir) || ".", entries: entries.map((e) => ({ name: e.name, directory: e.isDirectory() })) };
  }
  if (type === "read") { const file = resolveWorkspacePath(p.path); const stat = fs.statSync(file); if (stat.size > 1024 * 1024) throw new Error("文件过大，拒绝预览"); return { path: p.path, content: fs.readFileSync(file, "utf8") }; }
  if (type === "git-status") { const raw = await runGit(["worktree", "list", "--porcelain"]); return { status: await runGit(["status", "--short"]), branch: String(await runGit(["branch", "--show-current"])).trim(), diff: await runGit(["diff", "--stat"]), worktrees: raw.split(/\n\n/).filter(Boolean).map((block) => { const lines = block.split("\n"); return { path: lines.find((x) => x.startsWith("worktree "))?.slice(9), head: lines.find((x) => x.startsWith("HEAD "))?.slice(5), branch: lines.find((x) => x.startsWith("branch "))?.slice(7) || "detached" }; }) }; }
  if (type === "choose-worktree-target") { const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory", "createDirectory"] }); return result.canceled ? { cancelled: true } : { target: result.filePaths[0] }; }
  if (type === "git-stage") return workspaceApproval({ type, paths: (p.paths || []).map((x) => path.relative(currentCwd, resolveWorkspacePath(x))), summary: `暂存 ${p.paths?.length || 0} 个文件` });
  if (type === "git-commit") return workspaceApproval({ type, message: String(p.message || "Update").slice(0, 200), summary: `提交: ${String(p.message || "Update").slice(0, 80)}` });
  if (type === "git-branch") return workspaceApproval({ type, name: String(p.name || "codex/workspace").replace(/[^\w./-]/g, "-").slice(0, 80), summary: `创建分支 ${p.name}` });
  if (type === "worktree-add") { const name = String(p.name || "codex-worktree").replace(/[^\w.-]/g, "-"); const target = path.resolve(String(p.target || "")); if (!target || fs.existsSync(target) && fs.readdirSync(target).length) throw new Error("worktree target 必须不存在或为空目录"); const branch = `codex/${name}`; if ((await runGit(["branch", "--list", branch])).trim()) throw new Error("分支已存在"); return workspaceApproval({ type, name, target, startRef: String(p.startRef || "HEAD"), branch, summary: `创建 worktree ${target}` }); }
  if (type === "terminal-start") { if (!terminalSession) { terminalSession = spawn("cmd.exe", ["/d", "/q"], { cwd: currentCwd, windowsHide: true }); terminalSession.stdout.on("data", (d) => sendToRenderer("terminal:data", { data: d.toString() })); terminalSession.stderr.on("data", (d) => sendToRenderer("terminal:data", { data: d.toString(), error: true })); terminalSession.stdin.on("error", (error) => sendToRenderer("terminal:error", { message: error.message })); terminalSession.on("error", (error) => sendToRenderer("terminal:error", { message: error.message })); terminalSession.on("close", (code) => { sendToRenderer("terminal:status", { running: false, code }); terminalSession = null; }); } return { running: true }; }
  if (type === "terminal-write") { if (!terminalSession?.stdin?.writable) throw new Error("终端会话未启动"); terminalSession.stdin.write(String(p.data || "") + "\r\n"); return { running: true }; }
  if (type === "terminal-resize") return { supported: false, reason: "cmd.exe 无 PTY resize" };
  if (type === "terminal-kill") { terminalSession?.kill(); terminalSession = null; return { running: false }; }
  if (type === "terminal") return workspaceApproval({ type: "terminal-write", data: String(p.command || ""), summary: `执行命令: ${String(p.command || "").slice(0, 100)}` });
  if (type === "approve") {
    const action = pendingWorkspaceApprovals.get(String(p.id || ""));
    if (!action) throw new Error("审批票据无效、已拒绝或已使用");
    pendingWorkspaceApprovals.delete(String(p.id));
    if (action.type === "git-stage") return { output: await runGit(["add", "--", ...action.paths]) };
    if (action.type === "git-commit") return { output: await runGit(["commit", "-m", action.message]) };
    if (action.type === "git-branch") return { output: await runGit(["switch", "-c", action.name]) };
    if (action.type === "worktree-add") return { output: await runGit(["worktree", "add", "-b", action.branch, action.target, action.startRef]) };
    if (action.type === "terminal-write") { if (!terminalSession?.stdin?.writable) throw new Error("终端会话未启动"); terminalSession.stdin.write(action.data + "\r\n"); return { running: true }; }
  }
  if (type === "deny") { pendingWorkspaceApprovals.delete(String(p.id || "")); return { denied: true }; }
  throw new Error(`未知 workspace 操作: ${type}`);
});

function startPiRpc(cwd) {
  cwd = cwd || currentCwd;
  currentCwd = cwd;
  return new Promise((resolve, reject) => {
    const rpcEntry = path.join(__dirname, "..", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "rpc-entry.js");
    const ccswitchExt = path.join(__dirname, "ccswitch-provider.cjs");
    const deepseekExt = path.join(__dirname, "deepseek-provider.cjs");
    const permissionGateExt = path.join(__dirname, "permission-gate.cjs");
    const ccswitch = loadCcswitchCodexConfig();
    if (ccswitch && !runtimeApiKeys.has(ccswitch.providerId)) {
      runtimeApiKeys.set(ccswitch.providerId, ccswitch.apiKey);
    }
    const args = [rpcEntry, "--extension", permissionGateExt, "--extension", deepseekExt];
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
      const rpcError = new Error(`pi RPC 输入通道已关闭：${error.message}`);
      rejectPendingPiRequests(rpcError);
      if (!restartingPi) sendToRenderer("error", { message: rpcError.message });
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (piProcess !== child) return;
      piReady = false;
      const error = new Error(`pi RPC 已退出（退出码=${code}，信号=${signal}）`);
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
  activeSessionFile = state?.sessionFile || null;
  activeThinkingLevel = state?.thinkingLevel || await readSessionThinkingLevel(activeSessionFile);
  sendToRenderer("session:ready", { sessionId: state?.sessionId, sessionFile: state?.sessionFile, cwd: currentCwd });
  publishProviderList();
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
  const [levels, stats] = await Promise.all([
    sendPiCommand({ type: "get_available_thinking_levels" }),
    sendPiCommand({ type: "get_session_stats" }),
  ]);
  const availableLevels = levels?.levels || [];
  if (!availableLevels.includes(activeThinkingLevel)) activeThinkingLevel = availableLevels[0] || "off";
  sendToRenderer("session:state", { ...currentState, thinkingLevel: activeThinkingLevel, cwd: currentCwd });
  sendToRenderer("session:queue", pendingGuiMessages);
  sendToRenderer("session:thinking-levels", availableLevels);
  sendToRenderer("session:stats", stats || {});
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
  const authStatuses = new Map(runtime.getProviders().map((provider) => [provider.id, runtime.getProviderAuthStatus(provider.id)]));
  const merged = mergeProviderStates(runtime.getProviders(), models, stored, runtimeApiKeys, authStatuses);
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
    if (message?.type === "session:set-model") {
      await sendPiCommand({ type: "set_model", provider: String(payload.provider || ""), modelId: String(payload.model || "") });
      await publishSessionState();
      return;
    }
    if (message?.type === "session:set-thinking") {
      const levels = await sendPiCommand({ type: "get_available_thinking_levels" });
      if (!levels?.levels?.includes(payload.level)) throw new Error("当前模型不支持所选思考强度");
      await sendPiCommand({ type: "set_thinking_level", level: payload.level });
      activeThinkingLevel = payload.level;
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
      sendToRenderer("status", { message: "正在压缩上下文..." });
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
    if (message?.type === "session:resources") {
      try {
        const result = await sendPiCommand({ type: "get_commands" });
        const commands = (result?.commands || []).map((command) => ({ kind: "command", name: command.name, source: command.source || "pi", path: "", status: "available", description: command.description }));
        sendToRenderer("session:resources", { resources: [...await scanPiResources(), ...commands], capabilities: { refresh: true, open: true } });
      } catch (error) { sendToRenderer("session:resources", { resources: [], error: error.message, capabilities: { refresh: true, open: true } }); }
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
    if (message?.type === "session:export-jsonl") {
      const sourcePath = assertSessionFile(activeSessionFile, path.join(os.homedir(), ".pi", "agent", "sessions"));
      const picked = await dialog.showSaveDialog(mainWindow, { title: "导出 pi 会话 JSONL", defaultPath: path.basename(sourcePath), filters: [{ name: "JSONL", extensions: ["jsonl"] }] });
      if (picked.canceled || !picked.filePath) return;
      const outputPath = copyFileVerified(sourcePath, picked.filePath);
      sendToRenderer("session:exported", { path: outputPath, format: "jsonl" });
      return;
    }
    if (message?.type === "resource:open") {
      const target = assertWhitelistedResource(resourceOpenWhitelist, String(payload?.path || ""));
      await shell.openPath(target);
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
    if (message?.type === "session:archive") return await archivePiSession(String(payload.path || ""));
    if (message?.type === "session:restore") return await restorePiSession(String(payload.path || ""));
    if (message?.type === "session:switch") {
      const sessionPath = String(payload.path || "");
      const sessions = await listPiSessions();
      if (!sessions.some((session) => session.path === sessionPath)) {
        throw new Error("所选 pi 会话不属于当前项目或已不可用");
      }
      const result = await sendPiCommand({ type: "switch_session", sessionPath });
      if (!result?.cancelled) {
        pendingGuiMessages = { steering: [], followUp: [] };
        await initializeRendererSession();
      }
      return;
    }
    if (message?.type === "auth:providers") {
      if (availableModels.length === 0) {
        const result = await sendPiCommand({ type: "get_available_models" });
        availableModels = result?.models || [];
      }
      publishProviderList();
      return;
    }
    if (message?.type === "auth:status") return await publishProviderStatus();
    if (message?.type === "mcp:list") {
      sendToRenderer("mcp:list", [{ status: "unsupported", source: "pi 0.81.1", error: "pi 0.81.1 文档明确不包含 built-in MCP，RPC 也无 MCP 事件或工具列表" }]);
      return;
    }
    if (message?.type === "auth:oauth") {
      const runtime = await getAuthRuntime();
      const provider = String(payload.provider || "");
      sendToRenderer("auth:oauth-status", { status: "starting", provider, message: "正在启动 pi OAuth 登录" });
      try {
        await runtime.login(provider, "oauth", {
          notify: (event) => {
            if (event.type === "auth_url" || event.type === "device_code") openAuthUrl(event, (url) => shell.openExternal(url));
            sendToRenderer("auth:oauth-event", { provider, event });
          },
          prompt: (prompt) => new Promise((resolve, reject) => {
            const id = `auth-${Date.now()}-${Math.random()}`;
            authPrompts.set(id, { resolve, reject, provider });
            sendToRenderer("auth:oauth-prompt", { id, provider, prompt });
          }),
        });
        restartingPi = true;
        try { stopPiRpc(); await startPiRpc(); await initializeRendererSession(); } finally { restartingPi = false; }
        sendToRenderer("auth:oauth-status", { status: "complete", provider, message: "OAuth 登录完成，凭据已保存到 pi auth store" });
        await publishProviderStatus();
      } catch (error) {
        sendToRenderer("auth:oauth-status", { status: "failed", provider, message: error?.message || String(error) });
        throw error;
      } finally {
        for (const [id, pending] of authPrompts) {
          if (pending.provider === provider) authPrompts.delete(id);
        }
      }
      return;
    }
    if (message?.type === "auth:prompt-response") { const pending = authPrompts.get(payload.id); if (!pending) throw new Error("身份验证请求未知或已处理"); authPrompts.delete(payload.id); if (payload.cancelled) pending.reject(new Error("身份验证已取消")); else pending.resolve(String(payload.value || "")); return; }
    if (message?.type === "auth:clear") {
      const runtime = await getAuthRuntime();
      const provider = String(payload.provider);
      if ((await runtime.listCredentials()).some((item) => item.providerId === provider)) await runtime.logout(provider);
      if (runtimeApiKeys.has(provider)) { await runtime.removeRuntimeApiKey(provider); runtimeApiKeys.delete(provider); }
      restartingPi = true;
      try { stopPiRpc(); await startPiRpc(); await initializeRendererSession(); } finally { restartingPi = false; }
      await publishProviderStatus();
      return;
    }
    if (message?.type === "auth:set-key") {
      const provider = String(payload.provider || "").trim();
      const apiKey = String(payload.apiKey || "").trim();
      if (!provider || !apiKey) throw new Error("provider 和 API Key 不能为空");
      const mode = payload.mode === "session" ? "session" : "stored";
      if (mode === "stored") {
        const runtime = await getAuthRuntime();
        await runtime.login(provider, "api_key", { prompt: async () => apiKey, notify: (event) => sendToRenderer("auth:oauth-event", { provider, event }) });
        runtimeApiKeys.delete(provider);
      } else {
        runtimeApiKeys.set(provider, apiKey);
      }
      restartingPi = true;
      stopPiRpc();
      try {
        await startPiRpc();
        await initializeRendererSession();
      } finally {
        restartingPi = false;
      }
      const states = await publishProviderStatus();
      const selected = states.find((item) => item.provider === provider);
      if (!selected?.available) sendToRenderer("error", { message: `无法从 ${provider} 获取可用模型，请检查 API Key` });
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

  installChineseMenu();

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
        <h2>Cagent 无法加载界面</h2><p>${message}</p><p>请关闭窗口后重新启动应用。</p>
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
