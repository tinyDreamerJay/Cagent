import { useRef, useCallback, useEffect, useState } from "react";

export type WsMessage = {
  type: string;
  payload: any;
};

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const [connected, setConnected] = useState(false);
  const listenersRef = useRef<Map<string, Set<(payload: any) => void>>>(new Map());

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    // Close existing connection first
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    // Clear any pending reconnect
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }

    const ws = new WebSocket("ws://localhost:4120");

    ws.onopen = () => {
      if (!mountedRef.current) { ws.close(); return; }
      setConnected(true);
      wsRef.current = ws;
      ws.send(JSON.stringify({ type: "session:init", payload: {} }));
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const msg: WsMessage = JSON.parse(event.data);
        const handlers = listenersRef.current.get(msg.type);
        if (handlers) {
          handlers.forEach((fn) => fn(msg.payload));
        }
      } catch {}
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      // Only handle close for the current socket
      if (wsRef.current !== ws) return;
      setConnected(false);
      wsRef.current = null;
      // Auto-reconnect after 2s
      reconnectRef.current = setTimeout(() => connect(), 2000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  const send = useCallback((type: string, payload?: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }));
    }
  }, []);

  const subscribe = useCallback((type: string, handler: (payload: any) => void) => {
    if (!listenersRef.current.has(type)) {
      listenersRef.current.set(type, new Set());
    }
    listenersRef.current.get(type)!.add(handler);
    return () => {
      listenersRef.current.get(type)?.delete(handler);
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  return { connected, send, subscribe };
}
