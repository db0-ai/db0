# @db0-ai/cli

Command-line interface for inspecting and managing [db0](https://github.com/db0-ai/db0) memories.

## Install

```bash
npm install @db0-ai/cli
```

## Commands

```bash
db0 list                          # list all memories
db0 list --scope user             # filter by scope
db0 search "dark mode"            # semantic search
db0 stats                         # memory statistics by scope and status
db0 export > memories.json        # export all memories as JSON
db0 import < memories.json        # import memories from JSON
```

## Options

| Flag | Description |
|---|---|
| `--db <path>` | Path to db0.sqlite (auto-detected from OpenClaw) |
| `--scope <scope>` | Filter by scope (user, session, task, agent) |
| `--limit <n>` | Max results |
| `--json` | Output as JSON |

## Documentation

See the [main db0 README](https://github.com/db0-ai/db0) for full documentation.

## License

MIT
