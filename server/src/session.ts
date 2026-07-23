import { WebSocket } from "ws";

function getProviderIds(rt: any): string[] {
  const ids = new Set<string>();
  for (const provider of rt?.getProviders?.() || []) {
    if (provider?.id) ids.add(provider.id);
  }
  for (const id of rt?.getRegisteredProviderIds?.() || []) ids.add(id);
  return [...ids];
}

export class CagentSession {
  public id: string;
  private ws: WebSocket;
  private modelRuntime: any;
  private sessionManager: any;
  private agentSession: any = null;
  private resolvedModel: any = null;

  constructor(ws: WebSocket, modelRuntime: any, sessionManager: any) {
    this.id = `cagent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.ws = ws;
    this.modelRuntime = modelRuntime;
    this.sessionManager = sessionManager;
  }

  async init() {
    // Session is pre-initialized via constructor 鈥?no-op
  }

  setApiKey(provider: string, key: string) {
    return this.modelRuntime.setRuntimeApiKey(provider, key);
  }

  getRegisteredProviderIds(): string[] {
    return getProviderIds(this.modelRuntime);
  }

  getAvailableModels(provider: string) {
    return this.modelRuntime.getAvailable(provider);
  }

  /**
   * Resolve the first available model, caching the result.
   * Subsequent calls return the cached model without API overhead.
   */
  async resolveModel(provider?: string): Promise<any> {
    if (this.resolvedModel) return this.resolvedModel;

    const providers = provider
      ? [provider]
      : getProviderIds(this.modelRuntime);

    for (const pid of providers) {
      const available = await this.modelRuntime.getAvailable(pid);
      if (available.length > 0) {
        this.resolvedModel = available[0];
        return this.resolvedModel;
      }
    }

    this.resolvedModel = null;
    return null;
  }

  /**
   * Clear the cached model 鈥?call when the API key changes.
   */
  resetModel() {
    this.resolvedModel = null;
  }

  /**
   * Start a new conversation within the same session.
   * Keeps modelRuntime and cached model; discards the agent session
   * so that the next prompt creates a fresh one.
   */
  newSession() {
    this.agentSession = null;
  }

  async prompt(text: string, options?: { images?: any[]; signal?: AbortSignal; modelId?: string; cwd?: string }) {
    if (!this.modelRuntime || !this.sessionManager) {
      this.send("error", { message: "浼氳瘽鏈垵濮嬪寲" });
      return;
    }

    try {
      // Lazy-loaded pi SDK
      let piSDK: any = null;
      async function getPiSDK() {
        if (!piSDK) {
          piSDK = await import("@earendil-works/pi-coding-agent");
        }
        return piSDK;
      }

      const pi = await getPiSDK();

      this.send("message:user", { text, images: options?.images });

            // Create or recreate agent session if model changed
      const needsNewSession = !this.agentSession ||
        (options?.modelId && options.modelId !== this.resolvedModel?.id);
      if (needsNewSession) {
        // Resolve model: prefer explicit modelId, fallback to cached/default
        let model: any;
        if (options?.modelId) {
          const providers = getProviderIds(this.modelRuntime);
          for (const pid of providers) {
            const available = await this.modelRuntime.getAvailable(pid);
            const found = available.find((m: any) => m.id === options.modelId);
            if (found) {
              model = found;
              this.resolvedModel = model;
              break;
            }
          }
        }
        if (!model) {
          model = await this.resolveModel();
        }
        if (!model) {
          this.send("error", { message: "没有可用模型，请检查 API Key 是否正确" });
          return;
        }
        const targetCwd = options?.cwd || process.cwd();
        const { session } = await pi.createAgentSession({
          sessionManager: this.sessionManager,
          modelRuntime: this.modelRuntime,
          model,
          cwd: targetCwd,
        });
        this.agentSession = session;
      }
const images = (options?.images || []).map((img: any) => ({
        type: "image",
        data: img.data,
        mimeType: img.mimeType || "image/png",
      }));

      let currentToolName = "";
      let anyOutput = false;
      let hasTokens = false;

      // Subscribe to session events to capture tokens, tool calls, and results
      const unsub = this.agentSession.subscribe((event: any) => {
        try {
          if (this.ws.readyState !== WebSocket.OPEN) return;

          // Handle message_update events (streaming LLM output)
          if (event.type === "message_update" && event.assistantMessageEvent) {
            const ev = event.assistantMessageEvent;
            if (ev.type === "text_delta" && ev.delta) {
              anyOutput = true;
              hasTokens = true;
              this.send("token", { text: ev.delta });
              return;
            }
            if (ev.type === "thinking_delta" && ev.delta) {
              anyOutput = true;
              hasTokens = true;
              this.send("token", { text: ev.delta });
              return;
            }
          if (ev.type === "toolcall_start") {
            anyOutput = true;
            currentToolName = ev.toolName || "tool";
            this.send("tool:call", {
              name: currentToolName,
                params: "(streaming...)",
              });
              return;
            }
            // Any other message_update also counts as output
            anyOutput = true;
            return;
          }

          // Handle tool execution events
          if (event.type === "tool_execution_start") {
            anyOutput = true;
            currentToolName = event.toolName || "tool";
            this.send("tool:call", {
              name: currentToolName,
              params: JSON.stringify(event.args || {}, null, 2),
            });
            return;
          }

          if (event.type === "tool_execution_end") {
            const output = event.result?.content
              ? (Array.isArray(event.result.content)
                ? event.result.content.map((c: any) => c.type === "text" ? c.text : "").join("\n")
                : String(event.result.content))
              : "";
            this.send("tool:result", {
              name: event.toolName || currentToolName,
              output: this.truncateString(output),
            });
            return;
          }

          // message_start for assistant also counts as output
          if (event.type === "message_start" && event.message?.role === "assistant") {
            anyOutput = true;
            return;
          }
        } catch (e: any) {
          console.log("[Cagent] subscribe error:", e.message);
        }
      });

      await this.agentSession.prompt(text, {
        signal: options?.signal,
        images: images.length > 0 ? images : undefined,
      });

      unsub();

      if (!anyOutput) {
        this.send("error", { message: "妯″瀷鏈繑鍥炰换浣曞唴瀹癸紝璇锋鏌?API Key 鏄惁姝ｇ‘锛屾垨鍒囨崲妯″瀷鍚庨噸璇?" });
      }
      this.send("message:done", {});
    } catch (err: any) {
      if (err.name === "AbortError") {
        this.send("message:aborted", {});
      } else {
        this.send("error", { message: err.message || String(err) });
      }
    }
  }

  abort() {
    this.agentSession?.abort().catch(() => {});
  }

  private truncateString(str: string): string {
    const maxLen = 8000;
    if (str.length > maxLen) {
      return str.slice(0, maxLen) + `\n... [truncated, ${str.length - maxLen} more bytes]`;
    }
    return str;
  }

  private send(type: string, payload: any) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }
}



