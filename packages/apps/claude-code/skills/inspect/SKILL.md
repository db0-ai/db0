---
name: inspect
description: Browse, inspect, and verify db0 agent memories. Use when the user wants to see what the agent remembers, search memories, check memory statistics, or verify memories against the current codebase.
argument-hint: "[scope or search query]"
---

# Memory Inspector

Use the db0 MCP tools to help the user inspect and verify agent memory.

## Workflow

1. **List / Search**: Call `db0_memory_list` to show all memories (or filter by scope). If `$ARGUMENTS` is provided, also call `db0_memory_search` with it as the query.

2. **Display results** as a table showing:
   - Memory ID (first 8 chars)
   - Scope
   - Status
   - Age (from the `age` field in results)
   - Summary or content preview (truncated to 80 chars)
   - Score (for search results)
   - ⚠️ indicator if `stalenessCaveat` is present

3. **Statistics**: Call `db0_memory_stats` to show memory counts by scope and status.

4. **Verification pass**: For each memory displayed, cross-reference against the codebase:
   - Call `db0_memory_verify` on memories that are older than 1 day or reference files/functions
   - For file paths mentioned in memories: use Glob or Read to check they still exist
   - For function/class names: use Grep to confirm they still exist in the codebase
   - For package references: check package.json for current versions

5. **Report**: After verification, append a verification summary:
   - ✅ Verified — references confirmed in codebase
   - ⚠️ Stale — referenced files/functions not found (suggest deletion or update)
   - ℹ️ Unverifiable — no concrete references to check

If any memories are flagged as stale, ask the user if they'd like to delete or update them.
