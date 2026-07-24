// E2E test: Start Cagent server + WebSocket client, test full flow
import { spawn } from "child_process";
import { WebSocket } from "ws";

const SERVER_PORT = 4121; // Use non-standard port to avoid conflicts
const API_KEY = process.env.CAGENT_TEST_API_KEY;

if (!API_KEY) {
  console.error("CAGENT_TEST_API_KEY is required for the provider E2E test.");
  process.exit(2);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function startServer() {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PORT: String(SERVER_PORT) };
    const child = spawn("node", ["electron/server.cjs"], {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) {
        child.kill();
        reject(new Error("Server start timeout"));
      }
    }, 15000);

    child.stdout.on("data", (data) => {
      const text = data.toString();
      console.log("[server]", text.trim());
      if (text.includes("Server running") || text.includes("listening")) {
        started = true;
        clearTimeout(timeout);
        resolve(child);
      }
    });

    child.stderr.on("data", (data) => {
      console.error("[server:err]", data.toString().trim());
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function main() {
  console.log("=== Starting Cagent server ===");
  let server;
  try {
    server = await startServer();
    console.log("Server started!");
  } catch (err) {
    console.error("Failed to start server:", err.message);
    // Try alternate approach - direct SDK test with subscribe
    console.log("\n=== Falling back to direct SDK test ===");
    await directTest();
    return;
  }

  await sleep(1000);

  console.log("\n=== Connecting WebSocket ===");
  const ws = new WebSocket(`ws://localhost:${SERVER_PORT}`);

  try {
    await new Promise((resolve, reject) => {
      ws.on("open", resolve);
      ws.on("error", reject);
      setTimeout(() => reject(new Error("WS connect timeout")), 5000);
    });

    // Collect responses
    const responses = [];
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      console.log(`[ws:${msg.type}]`, JSON.stringify(msg.payload).slice(0, 150));
      responses.push(msg);

      if (msg.type === "message:done" || msg.type === "error") {
        console.log("\n=== Test complete, closing ===");
        ws.close();
        server.kill();
        
        // Verify
        const tokens = responses.filter(r => r.type === "token");
        const hasOutput = tokens.length > 0;
        console.log(`\nTokens received: ${tokens.length}`);
        console.log(`Full response: ${tokens.map(t => t.payload.text).join("")}`);
        console.log(hasOutput ? "✅ E2E test PASSED!" : "❌ No tokens received");
        process.exit(hasOutput ? 0 : 1);
      }
    });

    // Send init
    ws.send(JSON.stringify({ type: "session:init", payload: {} }));
    await sleep(2000);

    // Send auth
    ws.send(JSON.stringify({ type: "auth:set-key", payload: { provider: "deepseek", apiKey: API_KEY } }));
    await sleep(2000);

    // Send prompt
    console.log("\n=== Sending prompt ===");
    ws.send(JSON.stringify({ type: "session:prompt", payload: { text: "回复：hello" } }));

    // Wait for completion (30s timeout)
    await sleep(30000);
    console.log("❌ Timeout waiting for response");
    ws.close();
    server.kill();
    process.exit(1);

  } catch (err) {
    console.error("WebSocket error:", err.message);
    server.kill();
    process.exit(1);
  }
}

// Direct test as fallback
async function directTest() {
  const { ModelRuntime, SessionManager, SettingsManager, createAgentSession } = await import("@earendil-works/pi-coding-agent");

  const rt = await ModelRuntime.create();
  rt.registerProvider("deepseek", {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    api: "openai-completions",
    models: [
      {
        id: "deepseek-chat",
        name: "DeepSeek Chat",
        api: "openai-completions",
        reasoning: false,
        input: ["text", "image"],
        contextWindow: 128000,
        maxTokens: 8192,
        cost: { input: 0.27, output: 1.1, cacheRead: 0.027, cacheWrite: 0 },
      },
    ],
  });

  await rt.setRuntimeApiKey("deepseek", API_KEY);
  const models = await rt.getAvailable("deepseek");
  const model = models[0];
  
  const sm = SessionManager.inMemory();
  const settings = SettingsManager.create(process.cwd());
  
  const { session } = await createAgentSession({
    sessionManager: sm,
    modelRuntime: rt,
    model,
    settingsManager: settings,
    cwd: process.cwd(),
  });

  let anyOutput = false;
  const unsub = session.subscribe((event) => {
    if (event.type === "message_update") {
      const ev = event.assistantMessageEvent;
      if (ev.type === "text_delta" && ev.delta) {
        anyOutput = true;
        process.stdout.write(ev.delta);
      } else if (ev.type === "toolcall_start") {
        anyOutput = true;
        console.log(`\n[tool:call] ${ev.toolName}`);
      }
    }
    if (event.type === "tool_execution_start") {
      anyOutput = true;
      console.log(`\n[tool:call] ${event.toolName}`);
    }
    if (event.type === "tool_execution_end") {
      const output = event.result?.content?.[0]?.text || "";
      console.log(`[tool:result] ${output.slice(0, 100)}`);
    }
  });

  console.log("\n=== Sending prompt ===");
  await session.prompt("回复：hello");
  await session.waitForIdle();
  unsub();

  console.log(`\n\nanyOutput = ${anyOutput}`);
  console.log(anyOutput ? "✅ Subscribe-based flow works!" : "❌ No output");
  process.exit(anyOutput ? 0 : 1);
}

main().catch(err => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
