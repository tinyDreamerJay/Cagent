const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("cagent", {
  platform: process.platform,
});
