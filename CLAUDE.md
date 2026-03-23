# db0 — Agent-Native Data Layer SDK

## Project Structure

npm workspaces monorepo under `@db0-ai/*` scope:
- `packages/core` — types, harness, memory/state/log components, extraction, embeddings
- `packages/backends/sqlite` — SQLite backend (sql.js, in-JS cosine similarity)
- `packages/backends/postgres` — PostgreSQL + pgvector backend
- `packages/apps/openclaw` — OpenClaw ContextEngine plugin (zero-config entry point)
- `packages/apps/claude-code` — Claude Code MCP server, skills, hooks
- `packages/inspector` — web UI for browsing memory, state, and logs
- `packages/cli` — CLI for memory operations
- `packages/benchmark` — memory quality benchmarks

## Testing

Run all tests: `npx vitest run`

PostgreSQL tests require `DB0_POSTGRES_URL` env var. Without it, postgres tests are skipped automatically.

```bash
DB0_POSTGRES_URL="postgresql://localhost/db0_test" npx vitest run
```

## GitHub Accounts

- **db0-ai/db0** repo uses the `lightcone0` GitHub account
  - Git identity: `Lightcone <lightconemail@gmail.com>` (local config, not global)
  - Switch before pushing: `gh auth switch --user lightcone0`
- **shenli/db0** is the private backup repo under the `shenli` account

## npm Publishing

- npm account: `lightcone`
- All packages are under the `@db0-ai/*` scope with public access
- Versions are kept in lockstep (all packages share the same version)
- Publish via `./scripts/publish.sh` (uses changesets) or directly:
  ```bash
  npm publish --workspace=packages/<path> --access public --otp=<code>
  ```
- OTP required (2FA enabled on npm account)
- Build before publishing: `npm run build`
