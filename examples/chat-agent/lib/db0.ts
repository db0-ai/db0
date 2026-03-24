import { db0, defaultEmbeddingFn, PROFILE_CONVERSATIONAL } from "@db0-ai/core";
import type { Harness } from "@db0-ai/core";
import { createSqliteBackend } from "@db0-ai/backends-sqlite";
import type { SqliteBackend } from "@db0-ai/backends-sqlite";

let backend: SqliteBackend | null = null;

async function getBackend(): Promise<SqliteBackend> {
  if (!backend) {
    backend = await createSqliteBackend({ dbPath: "./memory.sqlite" });
  }
  return backend;
}

/**
 * Get a db0 harness for a given chat session and user.
 */
export async function getHarness({
  sessionId,
  userId,
}: {
  sessionId: string;
  userId: string;
}): Promise<Harness> {
  const b = await getBackend();
  return db0.harness({
    agentId: "chat-agent",
    sessionId,
    userId,
    backend: b,
    embeddingFn: defaultEmbeddingFn,
    profile: PROFILE_CONVERSATIONAL,
  });
}

/**
 * Get a shared harness for reading all memories (not session-specific).
 */
export async function getGlobalHarness(): Promise<Harness> {
  const b = await getBackend();
  return db0.harness({
    agentId: "chat-agent",
    sessionId: "_global",
    userId: "demo-user",
    backend: b,
    embeddingFn: defaultEmbeddingFn,
    profile: PROFILE_CONVERSATIONAL,
  });
}
