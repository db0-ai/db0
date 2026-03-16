import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Db0Backend } from "@db0-ai/core";

/**
 * Resolve a storage string to a db0 backend.
 *
 * - `postgresql://...` or `postgres://...` → Postgres backend
 * - File path → SQLite at that path
 * - Undefined → SQLite at default path `~/.openclaw/db0.sqlite`
 */
export async function resolveBackend(storage?: string): Promise<Db0Backend> {
  if (
    typeof storage === "string" &&
    (storage.startsWith("postgresql://") || storage.startsWith("postgres://"))
  ) {
    const { createPostgresBackend } = await import("@db0-ai/backends-postgres");
    return createPostgresBackend({ connectionString: storage });
  }

  const { createSqliteBackend } = await import("@db0-ai/backends-sqlite");

  if (storage) {
    return createSqliteBackend({ dbPath: storage });
  }

  // Default: ~/.openclaw/db0.sqlite
  const defaultDir = join(homedir(), ".openclaw");
  const defaultPath = join(defaultDir, "db0.sqlite");
  if (existsSync(defaultPath)) {
    return createSqliteBackend({ dbPath: defaultPath });
  }

  return createSqliteBackend({ dbPath: defaultPath });
}
