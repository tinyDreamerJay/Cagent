const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  addResourcePath,
  assertSessionFile,
  assertWhitelistedResource,
  copyFileVerified,
} = require("../electron/resource-utils.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "cagent-resource-"));
const project = path.join(root, "project");
const skill = path.join(project, ".pi", "skills", "demo");
fs.mkdirSync(skill, { recursive: true });
fs.writeFileSync(path.join(skill, "SKILL.md"), "# demo");
const realSkill = fs.realpathSync(path.join(skill, "SKILL.md"));
const whitelist = new Set();
assert.equal(addResourcePath(whitelist, realSkill), realSkill);
assert.equal(assertWhitelistedResource(whitelist, realSkill), realSkill);
assert.throws(() => assertWhitelistedResource(whitelist, root), /inventory/);
const sessions = path.join(root, ".pi", "agent", "sessions", "project");
fs.mkdirSync(sessions, { recursive: true });
const session = path.join(sessions, "session.jsonl");
fs.writeFileSync(session, '{"type":"session"}\n');
assert.equal(assertSessionFile(session, path.join(root, ".pi", "agent", "sessions")), fs.realpathSync(session));
assert.throws(() => assertSessionFile(realSkill, path.join(root, ".pi", "agent", "sessions")), /outside/);
const exported = path.join(root, "export.jsonl");
assert.equal(copyFileVerified(session, exported), exported);
assert.equal(fs.readFileSync(exported, "utf8"), fs.readFileSync(session, "utf8"));
assert.throws(() => copyFileVerified(session, session), /differ/);
const stats = { tokens: { input: 3, output: 5, cacheRead: 2, cacheWrite: 1 }, cost: 0.01, contextUsage: { tokens: 8, contextWindow: 100, percent: 8 } };
assert.equal(stats.contextUsage.percent, 8);
assert.equal(stats.tokens.cacheRead, 2);
assert.equal("compaction" in stats, false);
console.log("resource boundary fixtures passed");
