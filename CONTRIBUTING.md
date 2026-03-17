# Contributing to db0

## Development Setup

### Prerequisites

- Node.js 20+
- npm 10+

### Install

```bash
git clone https://github.com/db0-ai/db0.git
cd db0
npm install
```

This is an npm workspaces monorepo. `npm install` at the root handles all packages.

### Build

```bash
npm run build
```

### Test

```bash
npx vitest run
```

Tests use Vitest. All packages have co-located `__tests__/` directories.

#### PostgreSQL Tests

PostgreSQL + pgvector tests are optional and skipped by default. To run them:

```bash
# Ensure PostgreSQL is running with pgvector extension enabled
DB0_POSTGRES_URL="postgresql://localhost/db0_test" npx vitest run
```

### Project Structure

```
packages/
├── core/                  # @db0-ai/core — types, harness, memory/state/log, extraction
├── backends/
│   ├── sqlite/            # @db0-ai/backends-sqlite — sql.js, zero native deps
│   └── postgres/          # @db0-ai/backends-postgres — PostgreSQL + pgvector
├── apps/
│   ├── openclaw/          # @db0-ai/openclaw — OpenClaw ContextEngine plugin
│   └── claude-code/       # @db0-ai/claude-code — MCP server, skills, hooks
├── inspector/             # @db0-ai/inspector — web UI
├── cli/                   # @db0-ai/cli — memory operations CLI
└── benchmark/             # @db0-ai/benchmark — memory quality benchmarks
```

### Key Concepts for Contributors

**Harness** — the core unit of db0, scoped to `(agentId, sessionId)`. All component access goes through the harness.

**Backend Interface** — `Db0Backend` is the only contract between the SDK and storage. Memory, state, and log operations all go through this interface.

**Profiles** — named configuration bundles for different workloads. Profiles tune extraction, retrieval scoring, decay, and enrichment settings.

**Apps vs Core** — Core provides primitives (memory, state, log, spawn). Apps are complete integrations built on core (OpenClaw plugin, Claude Code MCP server). Apps own framework-specific lifecycle; core owns the data layer.

## Making Changes

1. Create a branch from `main`
2. Make your changes
3. Run tests: `npx vitest run`
4. Open a pull request

### Changesets

This project uses [Changesets](https://github.com/changesets/changesets) for versioning. If your change affects published packages, add a changeset:

```bash
npx changeset
```

## Code Style

- TypeScript, strict mode
- No default exports — use named exports
- Tests co-located in `__tests__/` directories
- Prefer simplicity over abstraction
