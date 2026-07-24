const fs = require("fs");
const path = require("path");

function policyFor(tool, risk) {
  const raw = process.env.CAGENT_PERMISSION_POLICY || "";
  let config = {};
  try { config = raw ? JSON.parse(raw) : {}; } catch { config = {}; }
  return config[`${tool}:${risk}`] || config[tool] || config[risk] || (risk === "boundary" ? "block" : tool === "read" ? "allow" : "ask");
}

function resolveInside(cwd, value) {
  const target = path.resolve(cwd, String(value || ""));
  const root = path.resolve(cwd);
  const rootReal = fs.realpathSync.native(root);
  let existing = target;
  while (!fs.existsSync(existing)) { const next = path.dirname(existing); if (next === existing) return false; existing = next; }
  const real = fs.realpathSync.native(existing);
  return real === rootReal || real.startsWith(rootReal + path.sep);
}

function bashRisk(command) {
  const text = String(command || "");
  if (/\b(sudo|runas|Start-Process\s+-Verb\s+RunAs|setfacl|icacls)\b/i.test(text)) return "privilege";
  if (/(^|[;&|])\s*(format|diskpart|shutdown|reboot)\b|\b(rm|del|erase|rmdir)\b[^\n]*(--no-preserve-root|\/s|\/q|-rf?)|\b(git\s+reset\s+--hard|git\s+clean\s+-fd)/i.test(text)) return "destructive";
  if (/\b(curl|wget|Invoke-WebRequest|bitsadmin|nc|ssh|scp)\b|https?:\/\//i.test(text)) return "network";
  if (/\b(npm|pnpm|yarn|pip|cargo|choco|winget)\s+(install|add|remove|uninstall)\b/i.test(text)) return "install";
  return null;
}

module.exports = function permissionGate(pi) {
  pi.on("tool_call", async (event, ctx) => {
    const tool = String(event.toolName || "");
    const input = event.input || {};
    const cwd = event.cwd || process.cwd();
    let risk = null;
    let target = "";
    if (tool === "write" || tool === "edit" || tool === "read") {
      target = String(input.path || input.filePath || "");
      if (!resolveInside(cwd, target)) risk = "boundary";
      else if (tool === "write" || tool === "edit") risk = "mutation";
    } else if (tool === "bash") {
      risk = bashRisk(input.command) || "command";
    }
    if (!risk) return undefined;
    const policy = policyFor(tool, risk);
    if (policy === "allow") return undefined;
    if (policy === "block" || !ctx.hasUI) return { block: true, reason: `Permission policy blocked ${tool} (${risk})` };
    const detail = tool === "bash" ? String(input.command || "") : target;
    const choice = await ctx.ui.select(`Permission request\nTool: ${tool}\nRisk: ${risk}\nTarget/command: ${detail}`, ["Allow once", "Block"]);
    return choice === "Allow once" ? undefined : { block: true, reason: "Blocked by user" };
  });
};

module.exports.resolveInside = resolveInside;
module.exports.bashRisk = bashRisk;
