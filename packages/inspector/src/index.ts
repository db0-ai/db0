import type { Db0Backend } from "@db0-ai/core";
import { InspectorServer } from "./server.js";

export type InspectorRuntimeProfile = "generic" | "openclaw" | "claude-code" | "claude";

export interface InspectorRuntimeCapabilities {
  hasExplainApi?: boolean;
  hasIntegrityApi?: boolean;
  supportsFileSnapshots?: boolean;
  supportsFileRollback?: boolean;
  supportsJournalRecovery?: boolean;
  supportsContradictionLinks?: boolean;
}

export interface InspectorRuntimeConfig {
  /** Runtime profile controls product-specific inspector behaviors. */
  profile?: InspectorRuntimeProfile;
  /** Optional workspace path (useful for OpenClaw profile). */
  workspaceDir?: string;
  /** Optional current session file path. */
  sessionFile?: string;
  /** Optional human-readable description of memory management model. */
  memoryModel?: string;
  /** Optional explicit capability flags. */
  capabilities?: InspectorRuntimeCapabilities;
  /** Optional configuration metadata to display in the inspector UI. Secrets should be redacted before passing. */
  config?: InspectorDisplayConfig;
}

export interface InspectorDisplayConfig {
  /** Embedding provider name (e.g. "gemini", "ollama", "hash") */
  embeddingProvider?: string;
  /** Embedding model name (e.g. "gemini-embedding-001") */
  embeddingModel?: string;
  /** LLM model used by the host agent */
  llmModel?: string;
  /** Agent ID being inspected */
  agentId?: string;
  /** Backend type (e.g. "sqlite", "postgres") */
  backend?: string;
  /** Path to the database file (for sqlite) */
  dbPath?: string;
  /** Schema version of the database */
  schemaVersion?: number;
  /** Additional key-value pairs to display */
  extra?: Record<string, string>;
  /** List of all known agents (for multi-agent switching) */
  agents?: Array<{ id: string; name?: string }>;
}

export interface InspectorConfig {
  /** The db0 backend to inspect. */
  backend: Db0Backend;
  /** Restrict to a specific agentId. If omitted, shows all agents. */
  agentId?: string;
  /** Restrict to a specific userId. If omitted, shows all users. */
  userId?: string;
  /** Port to listen on. Default: 6460 */
  port?: number;
  /** Hostname to bind. Default: "127.0.0.1" (localhost only) */
  host?: string;
  /** Embedding function for search. Falls back to built-in hash embeddings. */
  embeddingFn?: (text: string) => Promise<Float32Array>;
  /** Optional auth token. If set, requests require Authorization: Bearer <token> */
  token?: string;
  /** Optional runtime profile metadata for use-case-aware inspector UX. */
  runtime?: InspectorRuntimeConfig;
}

/**
 * Create a memory inspector server.
 *
 * @example
 * ```ts
 * import { createInspector } from "@db0-ai/inspector";
 *
 * const inspector = createInspector({ backend });
 * const { url } = await inspector.start();
 * console.log(`Memory inspector at ${url}`);
 * ```
 */
export function createInspector(config: InspectorConfig): InspectorServer {
  return new InspectorServer(config);
}

export { InspectorServer } from "./server.js";
export type { InspectorConfig as InspectorServerConfig };
