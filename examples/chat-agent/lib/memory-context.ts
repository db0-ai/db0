/**
 * Stores the memory context used for each chat response.
 * Allows the frontend to show which memories backed each reply.
 */

export interface MemoryContextEntry {
  chatId: string;
  count: number;
  estimatedTokens: number;
  text: string;
  memories: Array<{
    id: string;
    content: string;
    scope: string;
    score: number;
  }>;
  timestamp: string;
}

const contextMap = new Map<string, MemoryContextEntry>();

export function saveMemoryContext(chatId: string, entry: Omit<MemoryContextEntry, "chatId" | "timestamp">) {
  contextMap.set(chatId, {
    ...entry,
    chatId,
    timestamp: new Date().toISOString(),
  });
}

export function getMemoryContext(chatId: string): MemoryContextEntry | null {
  return contextMap.get(chatId) ?? null;
}
