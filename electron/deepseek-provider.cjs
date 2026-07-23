module.exports = function registerDeepSeekProvider(pi) {
  // Pi requires either an environment-variable-bound apiKey or a literal key
  // for checkAuth to pass. We point to a CAGENT_DEEPSEEK_API_KEY env-var that
  // main.cjs sets to the user-provided key (or to a sentinel "1" so the models
  // are always listed). When the user updates the key via auth:set-key, main.cjs
  // restarts the RPC child with the real key in this env-var.
  pi.registerProvider("deepseek", {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "$CAGENT_DEEPSEEK_API_KEY",
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
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      {
        id: "deepseek-reasoner",
        name: "DeepSeek Reasoner",
        api: "openai-completions",
        reasoning: true,
        input: ["text"],
        contextWindow: 128000,
        maxTokens: 8192,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ],
  });
};
