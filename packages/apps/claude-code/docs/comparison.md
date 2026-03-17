# Comparison with Other Claude Code Memory Tools

## Matrix

| | db0 | total-recall | Nemp | claude-memory-plugin | MemoryGraph | mem0 | CLAUDE.md |
|---|---|---|---|---|---|---|---|
| Storage | SQLite / Postgres | Unknown (tiered) | JSON files | YAML files | SQLite / Neo4j | Vector DB (cloud) | Plain text |
| Semantic search | Yes (built-in embeddings) | Unknown | Term expansion | Optional (Ollama) | Fuzzy matching | Yes (LLM-powered) | grep only |
| Memory scopes | 4 (task/session/user/agent) | Tiered | Flat | 5 scopes | Flat | 3 (user/session/agent) | None |
| Superseding | Yes (audit trail) | Correction propagation | No | No | No | No | Overwrites |
| State management | Checkpoints + branching | No | No | No | No | No | No |
| Structured logging | Yes | No | No | No | No | No | No |
| Requires LLM | No | Unknown | No | Optional | No | Yes | No |
| Requires account | No | No | No | No | No | Yes | No |
| Cross-device sync | Yes (Postgres) | No | No | No | No | Yes (cloud) | git |
| L0 summaries | Yes (auto-generated) | No | No | No | No | No | No |

## vs. CLAUDE.md (built-in)

CLAUDE.md is static project instructions — plain text, no search, no scoping, no versioning. It works for "always use bun" but doesn't scale for dynamic, accumulated knowledge.

db0 and CLAUDE.md are **complementary**: CLAUDE.md for static project rules, db0 for dynamic agent knowledge that accumulates over time.

## vs. total-recall

The most popular Claude Code memory plugin. Has tiered memory and correction propagation. db0 differentiates with:
- **Real database storage** (SQLite/Postgres) instead of file-based
- **Semantic search** with built-in embeddings
- **State checkpoints** and structured logging beyond just memory
- **Cross-device sync** via Postgres
- **Programmable SDK** — same db0 database works from TypeScript, CLI, web inspector, and OpenClaw

## vs. Nemp Memory

100% local, JSON files, term-expansion search. Good for simplicity. db0 adds:
- **Actual semantic search** (not keyword expansion)
- **Scoped memory** with different lifetimes
- **Superseding** instead of overwriting
- **State management** and structured logging
- **Database-backed** — real queries, not file scanning

## vs. MemoryGraph

Graph-based MCP server with 8 backend options. Strong on relationships. db0 differentiates with:
- **Scoped memory** (task/session/user/agent) vs flat storage
- **Memory superseding** with audit trail
- **State checkpoints** and logging (not just memory)
- **L0 summaries** for token efficiency
- **Zero-config** — works out of the box without choosing backends or enabling modes

## vs. mem0

The largest memory player. Cloud-first, LLM-required, account-required. db0 is the opposite:
- **Fully local** — data stays on your machine (or your own Postgres)
- **No LLM required** — built-in hash embeddings, zero API calls
- **No account needed** — no signup, no API key, no cloud dependency
- **More primitives** — state checkpoints, logging, superseding, typed relationships
- **Open SDK** — same database accessible from CLI, web inspector, OpenClaw, or any TypeScript project

## vs. claude-memory-plugin

YAML-based with 5 scopes and optional Ollama embeddings. Closest in scope ambition. db0 adds:
- **Database storage** instead of YAML files (real queries, concurrent access)
- **Built-in embeddings** (no external Ollama dependency)
- **Superseding** with audit trail
- **State management** and structured logging
- **Hybrid search** (similarity + recency + popularity scoring)
- **Cross-device sync** via Postgres
