function mergeProviderStates(runtimeProviders, rpcModels, credentials, runtimeKeys, environment) {
  const modelsByProvider = new Map();
  for (const model of rpcModels || []) {
    if (!modelsByProvider.has(model.provider)) modelsByProvider.set(model.provider, []);
    modelsByProvider.get(model.provider).push(model.id);
  }
  const all = new Map((runtimeProviders || []).map((provider) => [provider.id, provider]));
  for (const provider of modelsByProvider.keys()) if (!all.has(provider)) all.set(provider, { id: provider, auth: {} });
  return [...all.values()].map((provider) => {
    const models = modelsByProvider.get(provider.id) || [];
    const stored = credentials.get(provider.id);
    const env = environment.has(provider.id);
    return { provider: provider.id, configured: Boolean(stored || runtimeKeys.has(provider.id) || env), available: models.length > 0, source: stored ? `stored:${stored}` : runtimeKeys.has(provider.id) ? "runtime" : env ? "environment" : "catalog", capabilities: { apiKey: Boolean(provider.auth?.apiKey), oauth: Boolean(provider.auth?.oauth) }, models };
  });
}

function openAuthUrl(event, openExternal) {
  const url = event?.url || event?.verificationUri;
  if (!url || !/^https?:\/\//i.test(url)) throw new Error("OAuth URL scheme rejected");
  return openExternal(url);
}

module.exports = { mergeProviderStates, openAuthUrl };
