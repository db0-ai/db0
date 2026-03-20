/**
 * Convenience factory for setting up db0 with LangChain.js.
 *
 * Usage:
 *   import { createDb0 } from "@db0-ai/langchain";
 *
 *   const memory = await createDb0();
 *   const agent = createReactAgent({ llm, tools: [...yourTools, ...memory.tools] });
 */

import { db0, defaultEmbeddingFn, PROFILE_CONVERSATIONAL } from "@db0-ai/core";
import type { Harness, EmbeddingFn, Db0Profile, Db0Backend } from "@db0-ai/core";
import { createSqliteBackend } from "@db0-ai/backends-sqlite";
import { db0MemoryTools } from "./tools.js";
import { Db0ChatMessageHistory } from "./chat-history.js";

export interface CreateDb0Options {
  /** Path to SQLite file. Default: "./db0.sqlite". Ignored if `backend` is provided. */
  dbPath?: string;
  /** Pre-configured backend (e.g., PostgreSQL). Overrides dbPath. */
  backend?: Db0Backend;
  /** Agent identifier. Default: "langchain" */
  agentId?: string;
  /** Session identifier. Default: auto-generated */
  sessionId?: string;
  /** User identifier. Default: "default" */
  userId?: string;
  /** Embedding function. Default: built-in hash embeddings */
  embeddingFn?: EmbeddingFn;
  /** db0 profile. Default: conversational */
  profile?: Db0Profile;
  /** Extract facts from chat history automatically. Default: true */
  extractFacts?: boolean;
}

export interface Db0Instance {
  /** Memory tools for LangChain.js agents (array of DynamicStructuredTool) */
  tools: ReturnType<typeof db0MemoryTools>;
  /** Chat message history with automatic fact extraction */
  chatHistory: Db0ChatMessageHistory;
  /** Direct harness access */
  harness: Harness;
  /** Start a new session */
  newSession: (sessionId?: string) => { harness: Harness; chatHistory: Db0ChatMessageHistory };
  /** Clean up */
  close: () => void;
}

export async function createDb0(
  options: CreateDb0Options = {},
): Promise<Db0Instance> {
  const {
    dbPath = "./db0.sqlite",
    agentId = "langchain",
    sessionId = `session-${Date.now()}`,
    userId = "default",
    embeddingFn = defaultEmbeddingFn,
    profile = PROFILE_CONVERSATIONAL,
    extractFacts = true,
  } = options;

  const backend = options.backend ?? await createSqliteBackend({ dbPath });

  let harness = db0.harness({
    agentId,
    sessionId,
    userId,
    backend,
    embeddingFn,
    profile,
  });

  let chatHistory = new Db0ChatMessageHistory({ harness, extractFacts });

  return {
    tools: db0MemoryTools({ harness }),
    chatHistory,
    harness,
    newSession: (newSessionId?: string) => {
      harness = db0.harness({
        agentId,
        sessionId: newSessionId ?? `session-${Date.now()}`,
        userId,
        backend,
        embeddingFn,
        profile,
      });
      chatHistory = new Db0ChatMessageHistory({ harness, extractFacts });
      return { harness, chatHistory };
    },
    close: () => harness.close(),
  };
}
