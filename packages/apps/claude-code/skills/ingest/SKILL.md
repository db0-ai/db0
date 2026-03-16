---
name: ingest
description: Extract and store durable facts from text into db0 memory. Use when the user says "remember this", wants to save information, or when important facts should be persisted across sessions.
argument-hint: "[text to remember]"
---

# Fact Ingestion

Extract durable facts from the provided text and store them in db0 memory.

## Workflow

1. Analyze `$ARGUMENTS` for durable facts worth remembering
2. For each fact, determine the appropriate scope:
   - `user` — user preferences, decisions, personal context (permanent, cross-session)
   - `agent` — agent-specific knowledge, patterns (permanent, all sessions)
   - `session` — current session context, decisions in progress
3. Call `db0_memory_write` for each extracted fact with:
   - `content`: the fact text
   - `scope`: determined scope
   - `tags`: relevant tags for filtering

If the text contains corrections to existing facts, first call `db0_memory_search` to find the old memory, then use `supersedes` to mark it as replaced.

## Examples

User: "remember that I prefer dark mode"
→ `db0_memory_write({ content: "User prefers dark mode", scope: "user", tags: ["preference", "ui"] })`

User: "actually I switched to light mode"
→ Search for existing dark mode preference, then supersede it with new light mode preference.
