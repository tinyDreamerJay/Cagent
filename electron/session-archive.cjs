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

function resolveDestinationDirectory(destinationDirectory, expectedParentDirectory) {
  fs.mkdirSync(destinationDirectory, { recursive: true });
  const directory = fs.realpathSync.native(path.resolve(destinationDirectory));
  if (expectedParentDirectory) {
    const expectedParent = fs.realpathSync.native(path.resolve(expectedParentDirectory));
    if (path.dirname(directory).toLowerCase() !== expectedParent.toLowerCase()) throw new Error("目标目录不在预期会话目录中");
  }
  return directory;
}

function resolveProjectArchiveDir(cwd, agentDir) {
  const sessionDir = getProjectSessionDir(cwd, agentDir);
  return resolveDestinationDirectory(getProjectArchiveDir(cwd, agentDir), sessionDir);
}

function getArchiveMove(sessionPath, cwd, agentDir) {
  const sessionDir = getProjectSessionDir(cwd, agentDir);
  const source = resolveDirectSessionFile(sessionPath, sessionDir);
  const destinationDirectory = resolveProjectArchiveDir(cwd, agentDir);
  const destination = path.join(destinationDirectory, path.basename(source));
  if (fs.existsSync(destination)) throw new Error("目标目录中已存在同名会话");
  return { source, destination };
}

function validateArchiveSessionFile(sessionPath, cwd, agentDir) {
  getArchiveMove(sessionPath, cwd, agentDir);
}

function moveWithoutOverwrite(source, destinationDirectory) {
  const directory = resolveDestinationDirectory(destinationDirectory);
  const destination = path.join(directory, path.basename(source));
  if (fs.existsSync(destination)) throw new Error("目标目录中已存在同名会话");
  fs.renameSync(source, destination);
  return destination;
}

function archiveSessionFile(sessionPath, cwd, agentDir) {
  const { source, destination } = getArchiveMove(sessionPath, cwd, agentDir);
  fs.renameSync(source, destination);
  return destination;
}

function restoreSessionFile(sessionPath, cwd, agentDir) {
  const archiveDir = resolveProjectArchiveDir(cwd, agentDir);
  const source = resolveDirectSessionFile(sessionPath, archiveDir);
  return moveWithoutOverwrite(source, getProjectSessionDir(cwd, agentDir));
}

module.exports = { archiveSessionFile, getProjectArchiveDir, getProjectSessionDir, resolveProjectArchiveDir, restoreSessionFile, validateArchiveSessionFile };
