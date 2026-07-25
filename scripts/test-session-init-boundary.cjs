const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "client", "src", "App.tsx"), "utf8");
const mainSource = fs.readFileSync(path.join(root, "electron", "main.cjs"), "utf8");

const readyStart = appSource.indexOf('subscribe("session:ready"');
const readyEnd = appSource.indexOf('subscribe("session:list"', readyStart);
assert.notEqual(readyStart, -1, "session:ready subscription is missing");
assert.notEqual(readyEnd, -1, "session:ready subscription boundary is missing");
assert.doesNotMatch(
  appSource.slice(readyStart, readyEnd),
  /send\("auth:providers"\)/,
  "session:ready must not request auth:providers; that creates an IPC initialization loop",
);

const providerHandlerStart = mainSource.indexOf('message?.type === "auth:providers"');
const providerHandlerEnd = mainSource.indexOf('message?.type === "auth:status"', providerHandlerStart);
assert.notEqual(providerHandlerStart, -1, "auth:providers handler is missing");
assert.notEqual(providerHandlerEnd, -1, "auth:providers handler boundary is missing");
const providerHandler = mainSource.slice(providerHandlerStart, providerHandlerEnd);
assert.doesNotMatch(
  providerHandler,
  /initializeRendererSession/,
  "auth:providers must not re-enter full session initialization",
);
assert.match(providerHandler, /publishProviderList\(\)/, "auth:providers must publish only the provider list");

console.log("session initialization boundary fixture passed");
