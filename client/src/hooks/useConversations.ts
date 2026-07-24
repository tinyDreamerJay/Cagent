 import { useState, useCallback, useRef, useEffect } from "react";

 const STORAGE_KEY = "cagent_conversations";
 const MAX_CONVERSATIONS = 50;

export interface ToolCall {
  id: string;
  name: string;
  params: string;
  result?: string;
  status?: "running" | "done" | "error";
  collapsed: boolean;
}

export interface Message {
   id: string;
   role: "user" | "assistant" | "error";
   text: string;
   images?: { data: string; mimeType: string }[];
  toolCalls?: ToolCall[];
  thinking?: string;
}

 export interface Conversation {
   id: string;
   title: string;
   messages: Message[];
   createdAt: number;
   updatedAt: number;
 }
 
 function loadConversations(): Conversation[] {
   try {
     const raw = localStorage.getItem(STORAGE_KEY);
     if (!raw) return [];
     const parsed = JSON.parse(raw);
     return Array.isArray(parsed) ? parsed : [];
   } catch {
     return [];
   }
 }
 
 function saveConversations(convs: Conversation[]) {
   try {
     localStorage.setItem(STORAGE_KEY, JSON.stringify(convs));
   } catch {
     console.warn("localStorage full — trimming oldest conversations");
     // Strip image data and retry
     const stripped = convs.map(c => ({
       ...c,
       messages: c.messages.map(m => ({
         ...m,
         images: undefined,
       })),
     }));
     const trimmed = stripped.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, Math.floor(MAX_CONVERSATIONS / 2));
     try {
       localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
     } catch {
       try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
     }
   }
 }
 
 function generateId(): string {
   return `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
 }
 
 function generateTitle(messages: Message[]): string {
   const firstUser = messages.find(m => m.role === "user");
   if (!firstUser) return "新对话";
   const text = firstUser.text.trim();
   if (!text) return "新对话";
   return text.length > 30 ? text.slice(0, 30) + "..." : text;
 }
 
 /**
  * Strip image base64 data from messages before storing to localStorage.
  */
 function stripImages(msgs: Message[]): Message[] {
   return msgs.map(m => ({
     ...m,
     images: m.images ? m.images.map(img => ({ data: "", mimeType: img.mimeType })) : undefined,
   }));
 }
 
 export function useConversations() {
   const [conversations, setConversations] = useState<Conversation[]>(() => loadConversations());
   const [activeId, setActiveId] = useState<string | null>(() => {
     const convs = loadConversations();
     return convs.length > 0 ? convs[convs.length - 1].id : null;
   });
   const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
   const convRef = useRef(conversations);
   convRef.current = conversations;
 
   const persistNow = useCallback(() => {
     if (saveTimerRef.current) {
       clearTimeout(saveTimerRef.current);
       saveTimerRef.current = null;
     }
     saveConversations(convRef.current);
   }, []);
 
   useEffect(() => {
     return () => {
       if (saveTimerRef.current) {
         clearTimeout(saveTimerRef.current);
       }
       persistNow();
     };
   }, [persistNow]);
 
   const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
 
   const activeConversation = activeId
     ? conversations.find(c => c.id === activeId) || null
     : null;
 
   const createConversation = useCallback((): string => {
     const id = generateId();
     const now = Date.now();
     const newConv: Conversation = {
       id,
       title: "新对话",
       messages: [],
       createdAt: now,
       updatedAt: now,
     };
     setConversations(prev => {
       let updated = [...prev, newConv];
       if (updated.length > MAX_CONVERSATIONS) {
         updated = [...updated]
           .sort((a, b) => b.updatedAt - a.updatedAt)
           .slice(0, MAX_CONVERSATIONS);
       }
       return updated;
     });
     setActiveId(id);
     return id;
   }, []);
 
   const updateConversation = useCallback((id: string, messages: Message[]) => {
     const title = generateTitle(messages);
     const cleaned = stripImages(messages);
     setConversations(prev => {
       const updated = prev.map(c =>
         c.id === id
           ? { ...c, messages: cleaned, title, updatedAt: Date.now() }
           : c
       );
       return updated;
     });
     if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
     saveTimerRef.current = setTimeout(() => {
       saveConversations(convRef.current);
     }, 400);
   }, []);
 
   const deleteConversation = useCallback((id: string) => {
     setConversations(prev => prev.filter(c => c.id !== id));
     setActiveId(prev => prev === id ? null : prev);
     if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
     saveTimerRef.current = setTimeout(() => {
       saveConversations(convRef.current);
     }, 400);
   }, []);
 
   const renameConversation = useCallback((id: string, title: string) => {
     setConversations(prev =>
       prev.map(c => c.id === id ? { ...c, title, updatedAt: Date.now() } : c)
     );
   }, []);
 
   const switchConversation = useCallback((id: string | null) => {
     setActiveId(id);
   }, []);
 
   return {
     conversations: sorted,
     activeConversation,
     activeId,
     createConversation,
     updateConversation,
     deleteConversation,
     renameConversation,
     switchConversation,
   };
 }
