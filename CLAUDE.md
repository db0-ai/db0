# db0 — Agent-Native Data Layer SDK

## Project Structure

npm workspaces monorepo under `@db0-ai/*` scope:
- `packages/core` — types, harness, memory/state/log components, extraction, embeddings
- `packages/backends/sqlite` — SQLite backend (sql.js, in-JS cosine similarity)
- `packages/backends/postgres` — PostgreSQL + pgvector backend
- `packages/apps/openclaw` — OpenClaw ContextEngine plugin (zero-config entry point)

## Testing

Run all tests: `npx vitest run`

### Local PostgreSQL Test Environment

PostgreSQL 17 installed via Homebrew with pgvector extension:
- Service: `brew services start/stop postgresql@17`
- Binary path: `/opt/homebrew/opt/postgresql@17/bin/`
- Test database: `db0_test` (created with `createdb db0_test`)
- pgvector enabled in `db0_test`
- Connection string: `postgresql://localhost/db0_test`

Run tests including postgres:
```bash
DB0_POSTGRES_URL="postgresql://localhost/db0_test" npx vitest run
```

Without `DB0_POSTGRES_URL`, postgres tests are skipped automatically.
