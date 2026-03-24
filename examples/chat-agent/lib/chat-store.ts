/**
 * Chat message store backed by a JSON file.
 *
 * Simple file-based persistence so chat history survives
 * page refreshes and dev server restarts.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";

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

const STORE_PATH = "./chats.json";

function load(): Map<string, ChatSession> {
  if (!existsSync(STORE_PATH)) return new Map();
  try {
    const data = JSON.parse(readFileSync(STORE_PATH, "utf-8"));
    return new Map(Object.entries(data));
  } catch {
    return new Map();
  }
}

function save(chats: Map<string, ChatSession>) {
  writeFileSync(STORE_PATH, JSON.stringify(Object.fromEntries(chats), null, 2));
}

export function listChats(): Omit<ChatSession, "messages">[] {
  const chats = load();
  return Array.from(chats.values())
    .map(({ id, title, createdAt }) => ({ id, title, createdAt }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getChat(id: string): ChatSession | null {
  return load().get(id) ?? null;
}

export function saveChat(id: string, messages: StoredMessage[]): void {
  const chats = load();
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
  save(chats);
}
