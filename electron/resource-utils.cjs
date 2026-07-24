const fs = require("fs");
const path = require("path");

function canonicalPath(value) {
  return fs.realpathSync.native(path.resolve(String(value)));
}

function isInsidePath(target, root) {
  return target === root || target.startsWith(root + path.sep);
}

function addResourcePath(whitelist, value) {
  const target = canonicalPath(value);
  whitelist.add(target);
  whitelist.add(path.dirname(target));
  return target;
}

function assertWhitelistedResource(whitelist, value) {
  const target = canonicalPath(value);
  if (!whitelist.has(target)) throw new Error("Resource path is not in the current pi inventory");
  return target;
}

function assertSessionFile(sessionFile, sessionsRoot) {
  if (!sessionFile || !fs.existsSync(sessionFile) || !fs.existsSync(sessionsRoot)) {
    throw new Error("Current pi session file is unavailable");
  }
  const target = canonicalPath(sessionFile);
  const root = canonicalPath(sessionsRoot);
  if (!isInsidePath(target, root) || path.extname(target).toLowerCase() !== ".jsonl") {
    throw new Error("Current pi session file is outside the pi sessions directory");
  }
  return target;
}

function copyFileVerified(source, destination) {
  const sourcePath = canonicalPath(source);
  const destinationPath = path.resolve(String(destination));
  if (destinationPath === sourcePath) throw new Error("Export destination must differ from the active pi session file");
  fs.copyFileSync(sourcePath, destinationPath);
  if (fs.statSync(destinationPath).size !== fs.statSync(sourcePath).size) {
    throw new Error("Exported session size verification failed");
  }
  return destinationPath;
}

module.exports = {
  addResourcePath,
  assertSessionFile,
  assertWhitelistedResource,
  canonicalPath,
  copyFileVerified,
  isInsidePath,
};
