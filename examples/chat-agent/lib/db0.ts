import { db0, defaultEmbeddingFn, PROFILE_CONVERSATIONAL } from "@db0-ai/core";
import type { Harness } from "@db0-ai/core";
import { createSqliteBackend } from "@db0-ai/backends-sqlite";
import type { SqliteBackend } from "@db0-ai/backends-sqlite";

let backend: SqliteBackend | null = null;

/**
 * Get a db0 harness for a given chat session and user.
 *
 * The backend is shared (singleton) — all harnesses use the same SQLite file.
 * Each harness has its own sessionId for scope isolation, but user-scoped
 * memories are visible across all sessions for the same userId.
 */
export async function getHarness({
  sessionId,
  userId,
}: {
  sessionId: string;
  userId: string;
}): Promise<Harness> {
  if (!backend) {
    backend = await createSqliteBackend({ dbPath: "./memory.sqlite" });
  }

  return db0.harness({
    agentId: "chat-agent",
    sessionId,
    userId,
    backend,
    embeddingFn: defaultEmbeddingFn,
    profile: PROFILE_CONVERSATIONAL,
  });
}
