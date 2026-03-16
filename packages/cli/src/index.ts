#!/usr/bin/env node
import { parseArgs } from "node:util";
import { resolveBackend } from "./resolve-backend.js";
import { list } from "./commands/list.js";
import { search } from "./commands/search.js";
import { stats } from "./commands/stats.js";
import { exportMemories } from "./commands/export.js";
import { importMemories } from "./commands/import.js";

const USAGE = `db0 — CLI for db0 agent memory

Usage:
  db0 <command> [options]

Commands:
  list      List memories for an agent
  search    Search memories by query
  stats     Show memory statistics
  export    Export memories as NDJSON
  import    Import memories from NDJSON

Global options:
  --storage <path>      Storage path or connection string (default: ~/.openclaw/db0.sqlite)
  --agent-id <id>       Agent ID (required)
  --json                Output as JSON (for list, search, stats)
  --help                Show this help

Examples:
  db0 list --agent-id my-agent
  db0 search "user preferences" --agent-id my-agent
  db0 stats --agent-id my-agent --json
  db0 export --agent-id my-agent --output backup.ndjson
  db0 import --agent-id my-agent --input backup.ndjson
  db0 list --agent-id my-agent --storage postgresql://user:pass@host/db
`;

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    console.log(USAGE);
    process.exit(0);
  }

  // Parse flags after the command
  const { values } = parseArgs({
    args: args.slice(1),
    options: {
      storage: { type: "string" },
      "agent-id": { type: "string" },
      scope: { type: "string" },
      limit: { type: "string" },
      scoring: { type: "string" },
      output: { type: "string" },
      input: { type: "string" },
      "session-id": { type: "string" },
      "include-embeddings": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: false,
    allowPositionals: true,
  });

  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }

  const agentId = values["agent-id"] as string | undefined;
  if (!agentId && command !== "help") {
    console.error("Error: --agent-id is required");
    process.exit(1);
  }

  const backend = await resolveBackend(values.storage as string | undefined);

  try {
    switch (command) {
      case "list":
        await list(backend, agentId!, {
          scope: values.scope as string | undefined,
          limit: values.limit ? Number(values.limit) : undefined,
          json: values.json as boolean,
        });
        break;

      case "search": {
        // Positional arg after "search" is the query
        const { positionals } = parseArgs({
          args: args.slice(1),
          options: {
            storage: { type: "string" },
            "agent-id": { type: "string" },
            scope: { type: "string" },
            limit: { type: "string" },
            scoring: { type: "string" },
            json: { type: "boolean", default: false },
          },
          strict: false,
          allowPositionals: true,
        });
        const query = positionals[0];
        if (!query) {
          console.error("Error: search requires a query argument");
          process.exit(1);
        }
        await search(backend, agentId!, query, {
          scope: values.scope as string | undefined,
          limit: values.limit ? Number(values.limit) : undefined,
          scoring: values.scoring as string | undefined,
          json: values.json as boolean,
        });
        break;
      }

      case "stats":
        await stats(backend, agentId!, {
          json: values.json as boolean,
        });
        break;

      case "export":
        await exportMemories(backend, agentId!, {
          scope: values.scope as string | undefined,
          output: values.output as string | undefined,
          includeEmbeddings: values["include-embeddings"] as boolean,
        });
        break;

      case "import":
        await importMemories(backend, agentId!, {
          input: values.input as string | undefined,
          sessionId: values["session-id"] as string | undefined,
        });
        break;

      default:
        console.error(`Unknown command: ${command}`);
        console.log(USAGE);
        process.exit(1);
    }
  } finally {
    backend.close();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
