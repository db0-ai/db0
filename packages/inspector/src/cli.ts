#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createSqliteBackend } from "@db0-ai/backends-sqlite";
import { createInspector } from "./index.js";
import type { InspectorDisplayConfig } from "./index.js";

const BLUE = "\x1b[34m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function findDb0Sqlite(): string | null {
  // Explicit env var
  if (process.env.DB0_SQLITE_PATH && existsSync(process.env.DB0_SQLITE_PATH)) {
    return process.env.DB0_SQLITE_PATH;
  }

  // OpenClaw standard locations
  const candidates = [
    process.env.OPENCLAW_HOME && join(process.env.OPENCLAW_HOME, "db0.sqlite"),
    join(homedir(), ".openclaw", "db0.sqlite"),
    join(homedir(), ".config", "openclaw", "db0.sqlite"),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function findWorkspaceDir(): string | undefined {
  const candidates = [
    process.env.OPENCLAW_HOME && join(process.env.OPENCLAW_HOME, "workspace"),
    join(homedir(), ".openclaw", "workspace"),
    join(homedir(), ".config", "openclaw", "workspace"),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

function readJsonSafe(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function readDisplayConfig(dbPath: string, agentId: string): InspectorDisplayConfig {
  const openclawDir = process.env.OPENCLAW_HOME || join(homedir(), ".openclaw");

  // Read db0 extension config
  const db0Config = readJsonSafe(join(openclawDir, "extensions", "db0", "db0.config.json"));

  // Read OpenClaw main config
  const ocConfig = readJsonSafe(join(openclawDir, "config.json"))
    ?? readJsonSafe(join(openclawDir, "openclaw.json"));

  const config: InspectorDisplayConfig = {
    agentId,
    backend: "sqlite",
    dbPath,
  };

  // Embedding provider from db0 config
  if (db0Config) {
    const emb = db0Config.embeddings;
    if (typeof emb === "string") {
      config.embeddingProvider = emb;
    } else if (emb && typeof emb === "object") {
      const embObj = emb as Record<string, unknown>;
      config.embeddingProvider = embObj.provider as string;
      if (embObj.model) config.embeddingModel = embObj.model as string;
    }
  }

  // LLM model and embedding search config from OpenClaw config
  if (ocConfig) {
    const agents = ocConfig.agents as Record<string, unknown> | undefined;
    if (agents) {
      const defaults = agents.defaults as Record<string, unknown> | undefined;
      if (defaults) {
        // Primary LLM model
        const model = defaults.model as Record<string, unknown> | undefined;
        if (model?.primary) {
          config.llmModel = model.primary as string;
        }

        // Memory search embedding (may override db0 config embedding model)
        const memSearch = defaults.memorySearch as Record<string, unknown> | undefined;
        if (memSearch) {
          if (memSearch.provider && !config.embeddingProvider) {
            config.embeddingProvider = memSearch.provider as string;
          }
          if (memSearch.model) {
            config.embeddingModel = memSearch.model as string;
          }
        }

        // Workspace
        if (defaults.workspace) {
          config.extra = config.extra || {};
          config.extra["workspace"] = defaults.workspace as string;
        }

        // Compaction mode
        const compaction = defaults.compaction as Record<string, unknown> | undefined;
        if (compaction?.mode) {
          config.extra = config.extra || {};
          config.extra["compaction"] = compaction.mode as string;
        }
      }

      // Agent list — find current agent's name
      const list = agents.list as Array<Record<string, unknown>> | undefined;
      if (list) {
        // Populate agent list for multi-agent switcher
        config.agents = list.map(a => ({
          id: a.id as string,
          name: (a.name as string) || undefined,
        }));

        const current = list.find(a => a.id === agentId);
        if (current?.name) {
          config.extra = config.extra || {};
          config.extra["agentName"] = current.name as string;
        }
        if (current?.model) {
          config.extra = config.extra || {};
          config.extra["agentModel"] = current.model as string;
        }
      }
    }

    // OpenClaw version
    const meta = ocConfig.meta as Record<string, unknown> | undefined;
    if (meta?.lastTouchedVersion) {
      config.extra = config.extra || {};
      config.extra["openclawVersion"] = meta.lastTouchedVersion as string;
    }

    // Plugin status
    const plugins = ocConfig.plugins as Record<string, unknown> | undefined;
    if (plugins) {
      const slots = plugins.slots as Record<string, unknown> | undefined;
      if (slots?.contextEngine) {
        config.extra = config.extra || {};
        config.extra["contextEngine"] = slots.contextEngine as string;
      }
    }
  }

  return config;
}

async function main() {
  const args = process.argv.slice(2);

  // Parse flags
  let dbPath = "";
  let port = 6460;
  let host = "127.0.0.1";
  let agentId = "main";
  let openBrowser = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      console.log(`
${BOLD}db0 inspect${RESET} — Open the memory inspector in your browser

${BOLD}Usage:${RESET}
  db0-inspect [options]

${BOLD}Options:${RESET}
  --db <path>       Path to db0.sqlite file (auto-detected from OpenClaw)
  --port <number>   Port to bind (default: 6460)
  --host <string>   Host to bind (default: 127.0.0.1)
  --agent <id>      Agent ID to inspect (default: main)
  --no-open         Don't open browser automatically
  -h, --help        Show this help
`);
      process.exit(0);
    }
    if (arg === "--db" && args[i + 1]) { dbPath = args[++i]; continue; }
    if (arg === "--port" && args[i + 1]) { port = Number(args[++i]); continue; }
    if (arg === "--host" && args[i + 1]) { host = args[++i]; continue; }
    if (arg === "--agent" && args[i + 1]) { agentId = args[++i]; continue; }
    if (arg === "--no-open") { openBrowser = false; continue; }
  }

  // Auto-detect db path if not provided
  if (!dbPath) {
    const detected = findDb0Sqlite();
    if (!detected) {
      console.error(`${YELLOW}Could not find db0.sqlite${RESET}`);
      console.error(`Searched: ~/.openclaw/db0.sqlite, ~/.config/openclaw/db0.sqlite`);
      console.error(`Set DB0_SQLITE_PATH or use --db <path>`);
      process.exit(1);
    }
    dbPath = detected;
  }

  if (!existsSync(dbPath)) {
    console.error(`${YELLOW}File not found:${RESET} ${dbPath}`);
    process.exit(1);
  }

  console.log(`${BLUE}db0 inspect${RESET}`);
  console.log(`  ${DIM}database:${RESET} ${dbPath}`);
  console.log(`  ${DIM}agent:${RESET}    ${agentId}`);

  const backend = await createSqliteBackend({ dbPath });
  const workspaceDir = findWorkspaceDir();
  const displayConfig = readDisplayConfig(dbPath, agentId);

  const inspector = createInspector({
    backend,
    agentId,
    port,
    host,
    runtime: {
      profile: "openclaw",
      workspaceDir,
      memoryModel: "OpenClaw ContextEngine + scoped durable memories + compaction safety snapshots",
      config: displayConfig,
    },
  });

  const { url } = await inspector.start();
  console.log(`  ${GREEN}ready:${RESET}    ${url}`);
  console.log(`  ${DIM}press Ctrl+C to stop${RESET}`);

  // Open browser
  if (openBrowser) {
    try {
      const { exec } = await import("node:child_process");
      const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      exec(`${cmd} ${url}`);
    } catch {
      // Non-fatal — user can open manually
    }
  }

  // Keep running
  process.on("SIGINT", async () => {
    console.log(`\n${DIM}Stopping inspector...${RESET}`);
    await inspector.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
