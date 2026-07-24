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

const commands = [
  { id: "state", type: "get_state" },
  { id: "models", type: "get_available_models" },
  { id: "thinking", type: "get_available_thinking_levels" },
  { id: "commands", type: "get_commands" },
  { id: "tree", type: "get_tree" },
  { id: "entries", type: "get_entries" },
  { id: "forkMessages", type: "get_fork_messages" },
  { id: "stats", type: "get_session_stats" },
  { id: "steeringMode", type: "set_steering_mode", mode: "one-at-a-time" },
  { id: "followUpMode", type: "set_follow_up_mode", mode: "one-at-a-time" },
  { id: "autoCompaction", type: "set_auto_compaction", enabled: true },
  { id: "autoRetry", type: "set_auto_retry", enabled: true },
];

const pending = new Set(commands.map((command) => command.id));
const failures = [];
let buffer = "";
let finished = false;
const timeout = setTimeout(() => {
  finish(2, `RPC smoke test timed out; pending: ${[...pending].join(", ")}`);
}, 15000);

function finish(code, message) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  child.kill();
  if (message) console.log(message);
  process.exit(code);
}

function acceptResponse(message) {
  if (!pending.has(message.id)) return;
  pending.delete(message.id);

  if (message.success === false) {
    failures.push(`${message.id}: ${message.error || "unknown RPC error"}`);
  }

  if (message.id === "models") {
    const found = message.data?.models?.some(
      (model) => model.provider === "custom-test" && model.id === "gpt-test",
    );
    if (!found) failures.push("models: custom-test/gpt-test was not discovered");
  }

  if (pending.size === 0) {
    finish(
      failures.length === 0 ? 0 : 1,
      failures.length === 0
        ? `pi RPC smoke passed (${commands.length} commands)`
        : `pi RPC smoke failed:\n${failures.join("\n")}`,
    );
  }
}

child.on("error", (error) => finish(1, `Failed to start pi RPC: ${error.message}`));
child.on("exit", (code) => {
  if (!finished) finish(1, `pi RPC exited before checks completed (code ${code})`);
});
child.stderr.on("data", (data) => process.stderr.write(data));
child.stdout.on("data", (data) => {
  buffer += data.toString();
  let newline;
  while ((newline = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, newline).replace(/\r$/, "");
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    try {
      acceptResponse(JSON.parse(line));
    } catch (error) {
      finish(1, `Invalid pi RPC output: ${error.message}`);
    }
  }
});

for (const command of commands) {
  child.stdin.write(`${JSON.stringify(command)}\n`);
}
