module.exports = function registerCcswitchProvider(pi) {
  const providerId = process.env.CAGENT_CCSWITCH_PROVIDER;
  const baseUrl = process.env.CAGENT_CCSWITCH_BASE_URL;
  const apiKey = process.env.CAGENT_CCSWITCH_API_KEY;
  const modelId = process.env.CAGENT_CCSWITCH_MODEL;
  const wireApi = process.env.CAGENT_CCSWITCH_WIRE_API;
  if (!providerId || !baseUrl || !apiKey || !modelId) return;

  const api = wireApi === "responses" ? "openai-responses" : "openai-completions";
  pi.registerProvider(providerId, {
    name: `ccswitch: ${providerId}`,
    baseUrl,
    apiKey: "$CAGENT_CCSWITCH_API_KEY",
    api,
    authHeader: true,
    models: [{
      id: modelId,
      name: modelId,
      api,
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 1000000,
      maxTokens: 32768,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }],
  });
};
