function mergeProviderStates(runtimeProviders, rpcModels, credentials, runtimeKeys, authStatuses) {
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
    const status = authStatuses.get(provider.id);
    const configured = Boolean(stored || runtimeKeys.has(provider.id) || status?.configured);
    const source = stored ? `stored:${stored}` : runtimeKeys.has(provider.id) ? "runtime" : status?.source || (configured ? "configured" : "catalog");
    return { provider: provider.id, configured, available: models.length > 0, source, capabilities: { apiKey: Boolean(provider.auth?.apiKey), oauth: Boolean(provider.auth?.oauth) }, models };
  });
}

function openAuthUrl(event, openExternal) {
  const raw = event?.url || event?.verificationUri;
  let url;
  try { url = new URL(raw); } catch { throw new Error("OAuth URL is invalid"); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("OAuth URL scheme rejected");
  return openExternal(url.href);
}

module.exports = { mergeProviderStates, openAuthUrl };
