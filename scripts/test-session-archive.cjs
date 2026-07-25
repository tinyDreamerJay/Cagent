const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { archiveSessionFile, getProjectArchiveDir, getProjectSessionDir, restoreSessionFile } = require("../electron/session-archive.cjs");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cagent-archive-"));
try {
  const cwd = path.join(tempRoot, "project");
  const agentDir = path.join(tempRoot, "agent");
  const sessionDir = getProjectSessionDir(cwd, agentDir);
  fs.mkdirSync(sessionDir, { recursive: true });
  const sessionFile = path.join(sessionDir, "session.jsonl");
  fs.writeFileSync(sessionFile, '{"type":"session"}\n', "utf8");

  const archived = archiveSessionFile(sessionFile, cwd, agentDir);
  assert.strictEqual(path.dirname(archived), getProjectArchiveDir(cwd, agentDir));
  assert.strictEqual(fs.existsSync(sessionFile), false);
  assert.strictEqual(fs.readFileSync(archived, "utf8"), '{"type":"session"}\n');

  const restored = restoreSessionFile(archived, cwd, agentDir);
  assert.strictEqual(restored, sessionFile);
  assert.strictEqual(fs.existsSync(restored), true);

  const outside = path.join(tempRoot, "outside.jsonl");
  fs.writeFileSync(outside, "{}\n", "utf8");
  assert.throws(() => archiveSessionFile(outside, cwd, agentDir), /预期目录/);

  const duplicateArchive = path.join(getProjectArchiveDir(cwd, agentDir), path.basename(sessionFile));
  fs.mkdirSync(path.dirname(duplicateArchive), { recursive: true });
  fs.writeFileSync(duplicateArchive, "{}\n", "utf8");
  assert.throws(() => archiveSessionFile(sessionFile, cwd, agentDir), /同名会话/);
  console.log("session archive fixture passed");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
