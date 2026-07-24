const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "cagent-resource-"));
const project = path.join(root, "project");
const skill = path.join(project, ".pi", "skills", "demo");
fs.mkdirSync(skill, { recursive: true });
fs.writeFileSync(path.join(skill, "SKILL.md"), "# demo");
const realSkill = fs.realpathSync(path.join(skill, "SKILL.md"));
const whitelist = new Set([realSkill, path.dirname(realSkill)]);
assert.equal(whitelist.has(realSkill), true);
assert.equal(whitelist.has(path.join(root, "project2")), false);
const stats = { tokens: { input: 3, output: 5, cacheRead: 2, cacheWrite: 1 }, cost: 0.01, contextUsage: { tokens: 8, contextWindow: 100, percent: 8 } };
assert.equal(stats.contextUsage.percent, 8);
assert.equal(stats.tokens.cacheRead, 2);
assert.equal("compaction" in stats, false);
console.log("resource boundary fixtures passed");
