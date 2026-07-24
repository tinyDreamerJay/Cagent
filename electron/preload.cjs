const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cagent", {
  platform: process.platform,
  pi: {
    send(type, payload) {
      ipcRenderer.send("pi:command", { type, payload });
    },
    onEvent(handler) {
      const listener = (_event, message) => handler(message);
      ipcRenderer.on("pi:event", listener);
      return () => ipcRenderer.removeListener("pi:event", listener);
    },
    isAvailable: true,
  },
  workspace: {
    request(type, payload) { return ipcRenderer.invoke("workspace:request", { type, payload }); },
    onEvent(handler) { const listener = (_event, message) => handler(message); ipcRenderer.on("workspace:event", listener); return () => ipcRenderer.removeListener("workspace:event", listener); },
  },
});
