#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  db0,
  defaultEmbeddingFn,
  type Db0Backend,
  type Harness,
  type MemoryScope,
} from "@db0-ai/core";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";

// === State ===

let backend: Db0Backend | null = null;
let harness: Harness | null = null;

const embeddingFn = defaultEmbeddingFn;
const agentId = process.env.DB0_AGENT_ID ?? "claude-code";
const userId = resolveUserId();

function resolveUserId(): string | undefined {
  const envUserId = process.env.DB0_USER_ID ?? process.env.CLAUDE_CODE_USER_ID;
  if (envUserId && envUserId.trim()) {
    return envUserId.trim();
  }

  const processUser = process.env.USER ?? process.env.USERNAME ?? process.env.LOGNAME;
  if (processUser && processUser.trim()) {
    return processUser.trim();
  }

  try {
    const name = userInfo().username;
    return name && name.trim() ? name.trim() : undefined;
  } catch {
    return undefined;
  }
}

async function ensureHarness(sessionId?: string): Promise<Harness> {
  if (!backend) {
    backend = await resolveBackend(process.env.DB0_STORAGE);
  }
  if (!harness) {
    harness = db0.harness({
      agentId,
      sessionId: sessionId ?? `session-${Date.now()}`,
      userId,
      backend,
    });
  }
  return harness;
}

async function resolveBackend(
  storage: string | undefined,
): Promise<Db0Backend> {
  if (
    storage &&
    (storage.startsWith("postgresql://") || storage.startsWith("postgres://"))
  ) {
    const mod = await import("@db0-ai/backends-postgres" as string);
    return mod.createPostgresBackend({ connectionString: storage });
  }

  let dbPath: string | undefined;
  if (storage && storage !== ":memory:") {
    dbPath = storage;
  } else if (!storage) {
    const dir = join(homedir(), ".claude");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    dbPath = join(dir, "db0.sqlite");
  }
  // storage === ":memory:" → dbPath stays undefined (in-memory)

  const mod = await import("@db0-ai/backends-sqlite" as string);
  return mod.createSqliteBackend({ dbPath });
}

// === Tool definitions ===

const TOOLS = [
  {
    name: "db0_memory_write",
    description:
      "Write a memory entry to db0. Use for storing durable facts, user preferences, decisions, or any information worth remembering across sessions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        content: {
          type: "string",
          description: "The memory content — a fact, preference, or decision",
        },
        scope: {
          type: "string",
          enum: ["task", "session", "user", "agent"],
          description:
            "Memory scope: 'user' (permanent, cross-session), 'agent' (permanent, all sessions), 'session' (current session), 'task' (current task)",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional tags for filtering (e.g., ['preference', 'ui'])",
        },
        summary: {
          type: "string",
          description: "Optional one-line summary (auto-generated if omitted)",
        },
        supersedes: {
          type: "string",
          description:
            "ID of an existing memory to supersede (marks old memory as superseded)",
        },
        metadata: {
          type: "object",
          description: "Optional arbitrary metadata",
        },
      },
      required: ["content", "scope"],
    },
  },
  {
    name: "db0_memory_search",
    description:
      "Search agent memories by semantic similarity. Returns the most relevant memories matching the query.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Natural language search query",
        },
        scope: {
          type: "array",
          items: {
            type: "string",
            enum: ["task", "session", "user", "agent"],
          },
          description:
            "Scopes to search (default: ['user', 'agent', 'session'])",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Filter by tags (AND — all must match)",
        },
        limit: {
          type: "number",
          description: "Max results (default: 8)",
        },
        includeSuperseded: {
          type: "boolean",
          description: "Include superseded memories (default: false)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "db0_memory_list",
    description:
      "List all memories, optionally filtered by scope. Shows memory ID, scope, status, and content preview.",
    inputSchema: {
      type: "object" as const,
      properties: {
        scope: {
          type: "string",
          enum: ["task", "session", "user", "agent"],
          description: "Filter by scope (omit for all)",
        },
        limit: {
          type: "number",
          description: "Max results (default: 50)",
        },
      },
    },
  },
  {
    name: "db0_memory_get",
    description: "Get a specific memory by ID.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "Memory ID" },
      },
      required: ["id"],
    },
  },
  {
    name: "db0_memory_delete",
    description: "Delete a memory by ID.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "Memory ID to delete" },
      },
      required: ["id"],
    },
  },
  {
    name: "db0_memory_stats",
    description:
      "Get memory statistics — count by scope and status. Useful for understanding the current state of agent memory.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "db0_state_checkpoint",
    description:
      "Create a state checkpoint. Use to save execution progress that can be restored later.",
    inputSchema: {
      type: "object" as const,
      properties: {
        step: { type: "number", description: "Step number" },
        label: { type: "string", description: "Descriptive label" },
        metadata: { type: "object", description: "Optional metadata" },
      },
      required: ["step", "label"],
    },
  },
  {
    name: "db0_state_restore",
    description:
      "Restore the most recent state checkpoint for the current session.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "db0_log_query",
    description: "Query structured log entries for the current agent.",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number",
          description: "Max entries to return (default: 20)",
        },
      },
    },
  },
];

// === Tool handlers ===

async function handleTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const h = await ensureHarness();

  switch (name) {
    case "db0_memory_write": {
      const embedding = await embeddingFn(args.content as string);
      const entry = await h.memory().write({
        content: args.content as string,
        scope: args.scope as MemoryScope,
        embedding,
        tags: (args.tags as string[]) ?? undefined,
        summary: (args.summary as string) ?? undefined,
        supersedes: (args.supersedes as string) ?? undefined,
        metadata: (args.metadata as Record<string, unknown>) ?? undefined,
      });
      return {
        id: entry.id,
        scope: entry.scope,
        status: entry.status,
        summary: entry.summary,
        createdAt: entry.createdAt,
      };
    }

    case "db0_memory_search": {
      const embedding = await embeddingFn(args.query as string);
      const results = await h.memory().search({
        embedding,
        scope: (args.scope as MemoryScope[]) ?? ["user", "agent", "session"],
        limit: (args.limit as number) ?? 8,
        includeSuperseded: (args.includeSuperseded as boolean) ?? false,
        tags: (args.tags as string[]) ?? undefined,
      });
      return results.map((r) => ({
        id: r.id,
        content:
          typeof r.content === "string" ? r.content : JSON.stringify(r.content),
        scope: r.scope,
        status: r.status,
        summary: r.summary,
        score: Math.round(r.score * 1000) / 1000,
        tags: r.tags,
        createdAt: r.createdAt,
      }));
    }

    case "db0_memory_list": {
      let memories = await h
        .memory()
        .list((args.scope as MemoryScope) ?? undefined);
      const limit = (args.limit as number) ?? 50;
      memories = memories.slice(0, limit);
      return memories.map((m) => ({
        id: m.id,
        content:
          typeof m.content === "string"
            ? m.content.slice(0, 200)
            : JSON.stringify(m.content).slice(0, 200),
        scope: m.scope,
        status: m.status,
        summary: m.summary,
        tags: m.tags,
        createdAt: m.createdAt,
      }));
    }

    case "db0_memory_get": {
      const entry = await h.memory().get(args.id as string);
      if (!entry) return { error: "Memory not found" };
      return {
        id: entry.id,
        content: entry.content,
        scope: entry.scope,
        status: entry.status,
        summary: entry.summary,
        tags: entry.tags,
        metadata: entry.metadata,
        createdAt: entry.createdAt,
        accessCount: entry.accessCount,
      };
    }

    case "db0_memory_delete": {
      await h.memory().delete(args.id as string);
      return { deleted: true, id: args.id };
    }

    case "db0_memory_stats": {
      const all = await h.memory().list();
      const stats: Record<string, Record<string, number>> = {};
      for (const m of all) {
        if (!stats[m.scope]) stats[m.scope] = {};
        stats[m.scope][m.status] = (stats[m.scope][m.status] ?? 0) + 1;
      }
      return { total: all.length, byScope: stats };
    }

    case "db0_state_checkpoint": {
      const cp = await h.state().checkpoint({
        step: args.step as number,
        label: args.label as string,
        metadata: (args.metadata as Record<string, unknown>) ?? undefined,
      });
      return {
        id: cp.id,
        step: cp.step,
        label: cp.label,
        createdAt: cp.createdAt,
      };
    }

    case "db0_state_restore": {
      const cp = await h.state().restore();
      if (!cp) return { restored: false, message: "No checkpoint found" };
      return {
        restored: true,
        id: cp.id,
        step: cp.step,
        label: cp.label,
        createdAt: cp.createdAt,
      };
    }

    case "db0_log_query": {
      const entries = await h.log().query((args.limit as number) ?? 20);
      return entries.map((e) => ({
        id: e.id,
        event: e.event,
        level: e.level,
        data: e.data,
        createdAt: e.createdAt,
      }));
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// === Server setup ===

const server = new Server(
  { name: "db0", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const result = await handleTool(
      request.params.name,
      (request.params.arguments as Record<string, unknown>) ?? {},
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: JSON.stringify({ error: message }) }],
      isError: true,
    };
  }
});

// === Start ===

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`db0 MCP server failed to start: ${err}\n`);
  process.exit(1);
});
