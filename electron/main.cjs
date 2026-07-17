const { app, BrowserWindow, shell } = require("electron");
const path = require("path");
const { fork } = require("child_process");

// Suppress EPIPE errors when running with piped stdio
process.stdout.on("error", () => {});
process.stderr.on("error", () => {});

const isDev = !app.isPackaged;
const SERVER_PORT = 4120;
const CLIENT_PORT = 5173;

let mainWindow = null;
let serverProcess = null;

function startServer() {
  return new Promise((resolve, reject) => {
    const serverEntry = path.join(__dirname, "server.cjs");
    serverProcess = fork(serverEntry, [], {
      env: { ...process.env, PORT: String(SERVER_PORT) },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });

    serverProcess.on("message", (msg) => {
      if (msg === "ready") resolve();
    });

    serverProcess.stdout?.on("data", (d) => console.log("[server]", d.toString().trim()));
    serverProcess.stdout?.on("error", () => {});
    serverProcess.stderr?.on("data", (d) => console.error("[server:err]", d.toString().trim()));
    serverProcess.stderr?.on("error", () => {});
    serverProcess.on("error", reject);
    serverProcess.on("exit", (code) => {
      if (code !== 0) reject(new Error(`Server exited ${code}`));
    });

    setTimeout(resolve, 10000);
  });
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 680,
    minHeight: 400,
    title: "Cagent",
    backgroundColor: "#0d0d0d",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev) {
    await mainWindow.loadURL(`http://localhost:${CLIENT_PORT}`);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    await mainWindow.loadFile(path.join(__dirname, "..", "client", "dist", "index.html"));
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.on("closed", () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  try {
    console.log("[Cagent] Starting server...");
    await startServer();
    console.log("[Cagent] Server ready, creating window...");
    await createWindow();
  } catch (err) {
    console.error("[Cagent] Failed to start:", err);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  stopServer();
  app.quit();
});

app.on("before-quit", stopServer);
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
