import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type ProviderState = { provider: string; configured: boolean; source: string; models: string[]; error?: string };
export type McpState = { name: string; source: string; status: "unsupported" | "configured" | "failed"; tools: string[]; error?: string };

export function providerStates(rt: any): ProviderState[] {
  const ids = new Set<string>();
  for (const p of rt?.getProviders?.() || []) if (p?.id) ids.add(p.id);
  for (const id of rt?.getRegisteredProviderIds?.() || []) ids.add(id);
  return [...ids].map(provider => {
    const status = rt?.getProviderAuthStatus?.(provider);
    return { provider, configured: Boolean(status?.configured), source: status?.source || "pi", models: [] };
  });
}

export function discoverMcp(): McpState[] {
  const candidates = [path.join(os.homedir(), ".pi", "agent", "mcp.json"), path.join(os.homedir(), ".pi", "agent", "settings.json")];
  for (const file of candidates) {
    try {
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      const servers = value.mcpServers || value.mcp || {};
      return Object.entries(servers).map(([name, cfg]: any) => ({ name, source: file, status: "configured", tools: [], error: cfg?.command ? undefined : "缺少 command，pi 0.81.1 未提供 MCP RPC" }));
    } catch { /* absent or invalid config is an empty discovery result */ }
  }
  return [];
}
