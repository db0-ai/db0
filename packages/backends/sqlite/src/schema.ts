export const SCHEMA_VERSION = 6;

export const CREATE_TABLES = `
  CREATE TABLE IF NOT EXISTS db0_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS db0_memory (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    session_id TEXT,
    user_id TEXT,
    content TEXT NOT NULL,
    summary TEXT,
    scope TEXT NOT NULL,
    embedding BLOB NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    access_count INTEGER NOT NULL DEFAULT 0,
    supersedes_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    version INTEGER NOT NULL DEFAULT 1,
    source_type TEXT,
    extraction_method TEXT,
    confidence REAL,
    valid_to TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_memory_agent_scope
    ON db0_memory(agent_id, scope);
  CREATE INDEX IF NOT EXISTS idx_memory_agent_session
    ON db0_memory(agent_id, session_id);
  CREATE INDEX IF NOT EXISTS idx_memory_user
    ON db0_memory(user_id);
  CREATE INDEX IF NOT EXISTS idx_memory_status
    ON db0_memory(status);
  CREATE INDEX IF NOT EXISTS idx_memory_supersedes
    ON db0_memory(supersedes_id);

  CREATE TABLE IF NOT EXISTS db0_memory_edges (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    edge_type TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_edges_source
    ON db0_memory_edges(source_id);
  CREATE INDEX IF NOT EXISTS idx_edges_target
    ON db0_memory_edges(target_id);
  CREATE INDEX IF NOT EXISTS idx_edges_type
    ON db0_memory_edges(edge_type);

  CREATE TABLE IF NOT EXISTS db0_state (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    step INTEGER NOT NULL,
    label TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    parent_checkpoint_id TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_state_agent_session
    ON db0_state(agent_id, session_id);
  CREATE INDEX IF NOT EXISTS idx_state_parent
    ON db0_state(parent_checkpoint_id);

  CREATE TABLE IF NOT EXISTS db0_log (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    event TEXT NOT NULL,
    level TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_log_agent_session
    ON db0_log(agent_id, session_id, created_at);
`;
