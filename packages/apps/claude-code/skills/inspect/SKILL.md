---
name: inspect
description: Browse and inspect db0 agent memories. Use when the user wants to see what the agent remembers, search memories, or check memory statistics.
argument-hint: "[scope or search query]"
---

# Memory Inspector

Use the db0 MCP tools to help the user inspect agent memory.

## Workflow

1. Call `db0_memory_list` to show all memories (or filter by scope)
2. Call `db0_memory_search` with the user's query to find relevant memories
3. Call `db0_memory_stats` to show memory statistics by scope and status

When displaying results, format them as a clear table showing:
- Memory ID (first 8 chars)
- Scope
- Status
- Summary or content preview (truncated to 80 chars)
- Score (for search results)

Use `$ARGUMENTS` as the search query if provided. If no arguments, list all memories.
