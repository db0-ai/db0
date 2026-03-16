/**
 * @db0-ai/claude-code
 *
 * Claude Code plugin for db0 — agent-native memory, state, and logging.
 *
 * This package provides:
 * - An MCP server exposing db0 memory/state/log as Claude Code tools
 * - Skills for memory inspection and fact ingestion
 * - Hook configuration for automated workflows
 *
 * ## Installation
 *
 * As a Claude Code plugin:
 *   claude plugin install db0
 *
 * Or configure the MCP server manually in .claude/settings.json:
 *   {
 *     "mcpServers": {
 *       "db0": {
 *         "command": "npx",
 *         "args": ["-y", "@db0-ai/claude-code"]
 *       }
 *     }
 *   }
 */

import type { Db0Backend } from "@db0-ai/core";

export { db0, defaultEmbeddingFn } from "@db0-ai/core";
export type {
  Harness,
  MemoryEntry,
  MemorySearchResult,
  MemoryScope,
  StateCheckpoint,
  LogEntry,
} from "@db0-ai/core";

/**
 * Inspector runtime capabilities for Claude Code profile.
 * Mirrors @db0-ai/inspector runtime capability keys without adding a hard dependency.
 */
export interface ClaudeInspectorRuntimeCapabilities {
  hasExplainApi?: boolean;
  hasIntegrityApi?: boolean;
  supportsFileSnapshots?: boolean;
  supportsFileRollback?: boolean;
  supportsJournalRecovery?: boolean;
  supportsContradictionLinks?: boolean;
}

/**
 * Inspector config shape compatible with @db0-ai/inspector `createInspector`.
 * Declared locally so this package can provide a helper without importing inspector.
 */
export interface ClaudeInspectorConfig {
  backend: Db0Backend;
  agentId?: string;
  userId?: string;
  port?: number;
  host?: string;
  embeddingFn?: (text: string) => Promise<Float32Array>;
  token?: string;
  runtime: {
    profile: "claude-code";
    workspaceDir?: string;
    sessionFile?: string;
    memoryModel: string;
    capabilities: ClaudeInspectorRuntimeCapabilities;
  };
}

export interface CreateClaudeInspectorConfigOptions {
  backend: Db0Backend;
  agentId?: string;
  userId?: string;
  port?: number;
  host?: string;
  embeddingFn?: (text: string) => Promise<Float32Array>;
  token?: string;
  /** Defaults to `~/.claude`. */
  workspaceDir?: string;
  sessionFile?: string;
  memoryModel?: string;
  capabilities?: ClaudeInspectorRuntimeCapabilities;
}

/**
 * Build a ready-to-use inspector config for Claude Code + db0.
 *
 * @example
 * ```ts
 * import { createInspector } from "@db0-ai/inspector";
 * import { createClaudeInspectorConfig } from "@db0-ai/claude-code";
 *
 * const cfg = createClaudeInspectorConfig({ backend });
 * const inspector = createInspector(cfg);
 * ```
 */
export function createClaudeInspectorConfig(
  opts: CreateClaudeInspectorConfigOptions,
): ClaudeInspectorConfig {
  return {
    backend: opts.backend,
    agentId: opts.agentId ?? "claude-code",
    userId: opts.userId,
    port: opts.port,
    host: opts.host,
    embeddingFn: opts.embeddingFn,
    token: opts.token,
    runtime: {
      profile: "claude-code",
      workspaceDir: opts.workspaceDir,
      sessionFile: opts.sessionFile,
      memoryModel: opts.memoryModel
        ?? "Claude Code MCP memory/state/log tools backed by db0 harness",
      capabilities: {
        hasExplainApi: true,
        hasIntegrityApi: true,
        supportsFileSnapshots: false,
        supportsFileRollback: false,
        supportsJournalRecovery: false,
        supportsContradictionLinks: false,
        ...(opts.capabilities ?? {}),
      },
    },
  };
}
