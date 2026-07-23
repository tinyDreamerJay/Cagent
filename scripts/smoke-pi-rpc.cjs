const { spawn } = require("child_process");

const child = spawn(process.execPath, [
  "node_modules/@earendil-works/pi-coding-agent/dist/rpc-entry.js",
  "--extension", "electron/ccswitch-provider.cjs",
  "--provider", "custom-test",
  "--model", "gpt-test",
  "--offline",
], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    CAGENT_CCSWITCH_PROVIDER: "custom-test",
    CAGENT_CCSWITCH_BASE_URL: "https://example.com",
    CAGENT_CCSWITCH_API_KEY: "test",
    CAGENT_CCSWITCH_MODEL: "gpt-test",
    CAGENT_CCSWITCH_WIRE_API: "responses",
  },
});

let buffer = "";
const timeout = setTimeout(() => finish(2, "RPC smoke test timed out"), 10000);

function finish(code, message) {
  clearTimeout(timeout);
  child.kill();
  if (message) console.log(message);
  process.exit(code);
}

child.stderr.on("data", (data) => process.stderr.write(data));
child.stdout.on("data", (data) => {
  buffer += data.toString();
  let newline;
  while ((newline = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, newline).replace(/\r$/, "");
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.id === "state") {
      child.stdin.write(`${JSON.stringify({ id: "models", type: "get_available_models" })}\n`);
    } else if (message.id === "models") {
      const found = message.data?.models?.some((model) => model.provider === "custom-test" && model.id === "gpt-test");
      finish(found ? 0 : 1, `ccswitch RPC model found: ${Boolean(found)}`);
    }
  }
});
child.stdin.write(`${JSON.stringify({ id: "state", type: "get_state" })}\n`);
