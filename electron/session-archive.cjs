const fs = require("fs");
const os = require("os");
const path = require("path");

function getProjectSessionDir(cwd, agentDir = path.join(os.homedir(), ".pi", "agent")) {
  const resolvedCwd = path.resolve(cwd);
  const safePath = `--${resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return path.join(agentDir, "sessions", safePath);
}

function getProjectArchiveDir(cwd, agentDir) {
  return path.join(getProjectSessionDir(cwd, agentDir), ".cagent-archive");
}

function resolveDirectSessionFile(filePath, expectedDirectory) {
  if (!filePath || path.extname(filePath).toLowerCase() !== ".jsonl" || !fs.existsSync(filePath) || !fs.existsSync(expectedDirectory)) {
    throw new Error("会话文件不可用");
  }
  const source = fs.realpathSync.native(path.resolve(filePath));
  const directory = fs.realpathSync.native(path.resolve(expectedDirectory));
  if (path.dirname(source).toLowerCase() !== directory.toLowerCase()) throw new Error("会话文件不在预期目录中");
  return source;
}

function moveWithoutOverwrite(source, destinationDirectory) {
  fs.mkdirSync(destinationDirectory, { recursive: true });
  const destination = path.join(destinationDirectory, path.basename(source));
  if (fs.existsSync(destination)) throw new Error("目标目录中已存在同名会话");
  fs.renameSync(source, destination);
  return destination;
}

function archiveSessionFile(sessionPath, cwd, agentDir) {
  const sessionDir = getProjectSessionDir(cwd, agentDir);
  const source = resolveDirectSessionFile(sessionPath, sessionDir);
  return moveWithoutOverwrite(source, getProjectArchiveDir(cwd, agentDir));
}

function restoreSessionFile(sessionPath, cwd, agentDir) {
  const archiveDir = getProjectArchiveDir(cwd, agentDir);
  const source = resolveDirectSessionFile(sessionPath, archiveDir);
  return moveWithoutOverwrite(source, getProjectSessionDir(cwd, agentDir));
}

module.exports = { archiveSessionFile, getProjectArchiveDir, getProjectSessionDir, restoreSessionFile };
