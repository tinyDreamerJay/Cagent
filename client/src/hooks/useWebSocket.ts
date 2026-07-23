import { useRef, useCallback, useEffect, useState } from "react";

export type WsMessage = {
  type: string;
  payload: any;
};

type CagentBridge = {
  pi?: {
    send: (type: string, payload?: any) => void;
    onEvent: (handler: (message: WsMessage) => void) => () => void;
    isAvailable?: boolean;
  };
};

declare global {
  interface Window {
    cagent?: CagentBridge;
  }
}

export function useWebSocket() {
  const mountedRef = useRef(true);
  const [connected, setConnected] = useState(false);
  const listenersRef = useRef<Map<string, Set<(payload: any) => void>>>(new Map());

  useEffect(() => {
    mountedRef.current = true;
    const bridge = window.cagent?.pi;
    if (!bridge) {
      setConnected(false);
      return () => { mountedRef.current = false; };
    }
    setConnected(true);
    const unsubscribe = bridge.onEvent((message) => {
      if (!mountedRef.current) return;
      const handlers = listenersRef.current.get(message.type);
      handlers?.forEach((handler) => handler(message.payload));
    });
    const initTimer = window.setTimeout(() => bridge.send("session:init"), 0);
    return () => {
      mountedRef.current = false;
      window.clearTimeout(initTimer);
      unsubscribe();
      setConnected(false);
    };
  }, []);

  const send = useCallback((type: string, payload?: any) => {
    window.cagent?.pi?.send(type, payload);
  }, []);

  const subscribe = useCallback((type: string, handler: (payload: any) => void) => {
    if (!listenersRef.current.has(type)) listenersRef.current.set(type, new Set());
    listenersRef.current.get(type)!.add(handler);
    return () => listenersRef.current.get(type)?.delete(handler);
  }, []);

  return { connected, send, subscribe };
}
