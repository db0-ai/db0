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

## Versioning & Publishing

### Version bumps (use Changesets, not manual edits)

All packages are in a fixed version group — they share the same version number.

```bash
# 1. Create a changeset (or write .changeset/<name>.md manually)
npx changeset

# 2. Consume changesets — bumps versions, updates internal deps, generates changelogs
npx changeset version

# 3. Build, test, commit, tag
npm run build
npx vitest run
git add -A && git commit -m "release: v<version>"
git tag v<version> && git push && git push --tags
```

New packages must be added to `.changeset/config.json` `fixed` group.

### npm publish

- npm account: `lightcone`
- All packages under `@db0-ai/*` scope with public access
- OTP required (2FA enabled)
- Full release: `./scripts/publish.sh` (runs preflight, changeset version, build, publish)
- Individual package: `npm publish --workspace=packages/<path> --access public --otp=<code>`
- Batch publish all:
  ```bash
  npx changeset publish --otp=<code>
  ```
