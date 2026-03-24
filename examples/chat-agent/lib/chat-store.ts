/**
 * Simple in-process chat message store.
 *
 * In a real app, you'd use a database. This is intentionally simple
 * to keep the focus on db0's memory system. Messages here are lost
 * on server restart — but db0 memories persist.
 */

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  messages: StoredMessage[];
}

const chats = new Map<string, ChatSession>();

export function listChats(): Omit<ChatSession, "messages">[] {
  return Array.from(chats.values())
    .map(({ id, title, createdAt }) => ({ id, title, createdAt }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getChat(id: string): ChatSession | null {
  return chats.get(id) ?? null;
}

export function saveChat(id: string, messages: StoredMessage[]): void {
  const existing = chats.get(id);
  const title =
    existing?.title ??
    messages.find((m) => m.role === "user")?.content.slice(0, 50) ??
    "New chat";

  chats.set(id, {
    id,
    title,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    messages,
  });
}
