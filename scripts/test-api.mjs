// Full flow test: AgentSession with DeepSeek
import { ModelRuntime, SessionManager, SettingsManager, createAgentSession } from "@earendil-works/pi-coding-agent";

const API_KEY = "sk-2e6d7c7a501e41989aa7647030a76088";

async function main() {
  // 1. Create ModelRuntime
  const rt = await ModelRuntime.create();
  
  // 2. Register DeepSeek provider with proper cost data
  rt.registerProvider("deepseek", {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    api: "openai-completions",
    models: [
      {
        id: "deepseek-chat",
        name: "DeepSeek Chat (Vision)",
        api: "openai-completions",
        reasoning: false,
        input: ["text", "image"],
        contextWindow: 128000,
        maxTokens: 8192,
        cost: { input: 0.27, output: 1.1, cacheRead: 0.027, cacheWrite: 0 },
      },
    ],
  });

  // 3. Set API Key
  await rt.setRuntimeApiKey("deepseek", API_KEY);
  console.log("Providers:", rt.getRegisteredProviderIds());

  // 4. Get available models
  const models = await rt.getAvailable("deepseek");
  console.log("Models:", models.map(m => m.id).join(", "));
  
  const model = models[0];
  console.log(`Using: ${model.provider}/${model.id}`);

  // 5. Create session with proper SettingsManager
  const sm = SessionManager.inMemory();
  const settings = SettingsManager.create(process.cwd());
  // Set defaults for the session
  settings.setDefaultProvider?.("deepseek");
  settings.setDefaultModel?.("deepseek-chat");

  const { session } = await createAgentSession({
    sessionManager: sm,
    modelRuntime: rt,
    model,
    settingsManager: settings,
    cwd: process.cwd(),
  });

  console.log(`Session active tools: ${session.getActiveToolNames().join(", ")}`);

  // 6. Subscribe to events to simulate what electron/server.cjs callbacks do
  let anyOutput = false;
  let currentTool = "";

  const unsubscribe = session.subscribe((event) => {
    // Print ALL event types to discover the actual API
    const summary = JSON.stringify(event, (k, v) => {
      if (k === 'token' || k === 'text' || k === 'delta') return String(v).slice(0, 50);
      if (k === 'content' || k === 'output' || k === 'thinking') return '[content]';
      return v;
    }).slice(0, 300);
    console.log(`[event:${event.type}]`, summary);
    
    if (event.type === "token") {
      anyOutput = true;
      process.stdout.write(event.token);
    }
  });

  // 7. Send prompt (without the callback options - they're ignored)
  console.log("\n=== Sending prompt ===");
  await session.prompt("请用一句话回复：你好，Cagent！");

  await session.waitForIdle();
  unsubscribe();

  console.log(`\nanyOutput = ${anyOutput}`);
  console.log(anyOutput ? "✅ AgentSession 流程正常！" : "❌ 未收到输出！");
  
  process.exit(anyOutput ? 0 : 1);
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  console.error(err.stack?.slice(0, 500));
  process.exit(1);
});
