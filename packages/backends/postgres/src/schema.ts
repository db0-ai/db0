export const SCHEMA_VERSION = 6;

/**
 * PostgreSQL schema with pgvector extension.
 * Requires: CREATE EXTENSION IF NOT EXISTS vector;
 */
export function createTableStatements(dimensions: number): string[] {
  return [
    `CREATE EXTENSION IF NOT EXISTS vector`,

    `CREATE TABLE IF NOT EXISTS db0_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,

    `CREATE TABLE IF NOT EXISTS db0_memory (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      session_id TEXT,
      user_id TEXT,
      content TEXT NOT NULL,
      summary TEXT,
      scope TEXT NOT NULL,
      embedding vector(${dimensions}) NOT NULL,
      tags JSONB NOT NULL DEFAULT '[]',
      metadata JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      access_count INTEGER NOT NULL DEFAULT 0,
      supersedes_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      version INTEGER NOT NULL DEFAULT 1,
      source_type TEXT,
      extraction_method TEXT,
      confidence REAL,
      valid_to TIMESTAMPTZ,
      content_tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
    )`,

    `CREATE INDEX IF NOT EXISTS idx_memory_agent_scope
      ON db0_memory(agent_id, scope)`,
    `CREATE INDEX IF NOT EXISTS idx_memory_agent_session
      ON db0_memory(agent_id, session_id)`,
    `CREATE INDEX IF NOT EXISTS idx_memory_user
      ON db0_memory(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_memory_status
      ON db0_memory(status)`,
    `CREATE INDEX IF NOT EXISTS idx_memory_supersedes
      ON db0_memory(supersedes_id)`,

    // HNSW index for fast approximate nearest neighbor search
    `CREATE INDEX IF NOT EXISTS idx_memory_embedding
      ON db0_memory USING hnsw (embedding vector_cosine_ops)`,

    // GIN index for full-text search
    `CREATE INDEX IF NOT EXISTS idx_memory_fts
      ON db0_memory USING gin (content_tsv)`,

    `CREATE TABLE IF NOT EXISTS db0_memory_edges (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES db0_memory(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES db0_memory(id) ON DELETE CASCADE,
      edge_type TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    `CREATE INDEX IF NOT EXISTS idx_edges_source
      ON db0_memory_edges(source_id)`,
    `CREATE INDEX IF NOT EXISTS idx_edges_target
      ON db0_memory_edges(target_id)`,
    `CREATE INDEX IF NOT EXISTS idx_edges_type
      ON db0_memory_edges(edge_type)`,

    `CREATE TABLE IF NOT EXISTS db0_state (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      step INTEGER NOT NULL,
      label TEXT,
      metadata JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      parent_checkpoint_id TEXT
    )`,

    `CREATE INDEX IF NOT EXISTS idx_state_agent_session
      ON db0_state(agent_id, session_id)`,
    `CREATE INDEX IF NOT EXISTS idx_state_parent
      ON db0_state(parent_checkpoint_id)`,

    `CREATE TABLE IF NOT EXISTS db0_log (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      event TEXT NOT NULL,
      level TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    `CREATE INDEX IF NOT EXISTS idx_log_agent_session
      ON db0_log(agent_id, session_id, created_at)`,
  ];
}
