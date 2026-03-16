#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { createInterface } from "node:readline";

const BLUE = "\x1b[34m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

// Candidate locations for OpenClaw data directory
const OPENCLAW_CANDIDATES = [
  process.env.OPENCLAW_HOME,
  join(homedir(), ".openclaw"),
  join(homedir(), ".config", "openclaw"),
];

function log(msg: string) {
  console.log(msg);
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Current plugin manifest — written during init and updated by set. */
function getManifest() {
  return {
    id: "db0",
    name: "db0 Memory & Context Engine",
    kind: "memory",
    description: "Agent-native semantic memory and context management — powered by db0",
    version: "0.1.0",
    configSchema: {
      type: "object",
      properties: {
        embeddings: {
          oneOf: [
            { type: "string", enum: ["hash", "ollama", "openai", "gemini", "auto"] },
            {
              type: "object",
              properties: {
                provider: { type: "string", enum: ["hash", "ollama", "openai", "gemini"] },
                model: { type: "string" },
                baseUrl: { type: "string" },
                apiKey: { type: "string" },
                dimensions: { type: "number" },
              },
            },
          ],
          description: "Embedding provider: 'gemini' (free, recommended), 'ollama', 'openai', or 'hash' (default)",
        },
        agentId: { type: "string" },
        enabled: { type: "boolean" },
      },
      additionalProperties: false,
    },
  };
}

/** Write (or update) the plugin manifest in the extensions directory. */
function ensureManifest(openclawDir: string) {
  const extDir = join(openclawDir, "extensions", "db0");
  const manifestPath = join(extDir, "openclaw.plugin.json");
  if (existsSync(extDir)) {
    writeFileSync(manifestPath, JSON.stringify(getManifest(), null, 2));
  }
}

/** db0's own config file — separate from openclaw.json to avoid Zod validation conflicts. */
function db0ConfigPath(openclawDir: string): string {
  return join(openclawDir, "extensions", "db0", "db0.config.json");
}

function readDb0Config(openclawDir: string): Record<string, unknown> {
  const p = db0ConfigPath(openclawDir);
  if (existsSync(p)) {
    try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return {}; }
  }
  return {};
}

function writeDb0Config(openclawDir: string, config: Record<string, unknown>) {
  writeFileSync(db0ConfigPath(openclawDir), JSON.stringify(config, null, 2) + "\n");
}

function resolveOpenClawDir(explicit?: string): string {
  if (explicit) return resolve(explicit);
  if (process.env.OPENCLAW_HOME) return resolve(process.env.OPENCLAW_HOME);
  for (const candidate of OPENCLAW_CANDIDATES) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return join(homedir(), ".openclaw");
}

function readConfig(openclawDir: string): Record<string, unknown> {
  const configPath = join(openclawDir, "openclaw.json");
  if (existsSync(configPath)) {
    try {
      return JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      return {};
    }
  }
  return {};
}

function writeConfig(openclawDir: string, config: Record<string, unknown>) {
  const configPath = join(openclawDir, "openclaw.json");
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

function getDb0Entry(config: Record<string, unknown>): Record<string, unknown> {
  const plugins = (config.plugins ?? {}) as Record<string, unknown>;
  const entries = (plugins.entries ?? {}) as Record<string, unknown>;
  return (entries["db0"] ?? {}) as Record<string, unknown>;
}

function setDb0Entry(config: Record<string, unknown>, entry: Record<string, unknown>) {
  if (!config.plugins || typeof config.plugins !== "object") config.plugins = {};
  const plugins = config.plugins as Record<string, unknown>;
  if (!plugins.entries || typeof plugins.entries !== "object") plugins.entries = {};
  const entries = plugins.entries as Record<string, unknown>;
  entries["db0"] = entry;
}

// === Claude Code MCP server helpers ===

const CLAUDE_CODE_DIR = join(homedir(), ".claude");
const CLAUDE_SETTINGS_PATH = join(CLAUDE_CODE_DIR, "settings.json");

function readClaudeSettings(): Record<string, unknown> {
  if (existsSync(CLAUDE_SETTINGS_PATH)) {
    try { return JSON.parse(readFileSync(CLAUDE_SETTINGS_PATH, "utf-8")); } catch {}
  }
  return {};
}

function writeClaudeSettings(settings: Record<string, unknown>) {
  ensureDir(CLAUDE_CODE_DIR);
  writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
}

function isClaudeCodeInstalled(): boolean {
  const settings = readClaudeSettings();
  const servers = (settings.mcpServers ?? {}) as Record<string, unknown>;
  return "db0" in servers;
}

function installClaudeCodeMcp() {
  const settings = readClaudeSettings();
  if (!settings.mcpServers || typeof settings.mcpServers !== "object") {
    settings.mcpServers = {};
  }
  const servers = settings.mcpServers as Record<string, unknown>;
  servers["db0"] = {
    command: "npx",
    args: ["-y", "@db0-ai/claude-code"],
  };
  writeClaudeSettings(settings);
}

function removeClaudeCodeMcp() {
  const settings = readClaudeSettings();
  const servers = (settings.mcpServers ?? {}) as Record<string, unknown>;
  delete servers["db0"];
  writeClaudeSettings(settings);
}

// === Args parsing ===

interface CliArgs {
  command?: string;
  subcommand?: string;
  positional: string[];
  dir?: string;
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): CliArgs {
  const result: CliArgs = { positional: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dir" && i + 1 < argv.length) {
      result.dir = argv[++i];
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        result.flags[key] = argv[++i];
      } else {
        result.flags[key] = true;
      }
    } else if (!result.command) {
      result.command = arg;
    } else if (!result.subcommand) {
      result.subcommand = arg;
    } else {
      result.positional.push(arg);
    }
  }
  return result;
}

// === Interactive helpers ===

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

interface DetectedProvider {
  name: string;
  label: string;
  reason: string;
  available: boolean;
}

async function detectProviders(): Promise<DetectedProvider[]> {
  const providers: DetectedProvider[] = [];

  // Gemini — check env vars
  const geminiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY ?? process.env.GOOGLE_API_KEY;
  providers.push({
    name: "gemini",
    label: "Gemini",
    reason: geminiKey ? "GEMINI_API_KEY detected" : "no API key found",
    available: !!geminiKey,
  });

  // Ollama — check if server is running
  let ollamaUp = false;
  try {
    const res = await fetch("http://localhost:11434/api/tags", {
      signal: AbortSignal.timeout(1500),
    });
    ollamaUp = res.ok;
  } catch {
    // not running
  }
  providers.push({
    name: "ollama",
    label: "Ollama",
    reason: ollamaUp ? "local server detected" : "not running",
    available: ollamaUp,
  });

  // OpenAI — check env var
  const openaiKey = !!process.env.OPENAI_API_KEY;
  providers.push({
    name: "openai",
    label: "OpenAI",
    reason: openaiKey ? "OPENAI_API_KEY detected" : "no API key found",
    available: openaiKey,
  });

  // Hash — always available
  providers.push({
    name: "hash",
    label: "Hash (built-in)",
    reason: "zero-config, instant, not semantic",
    available: true,
  });

  return providers;
}

// === Commands ===

async function init(explicitDir?: string, upgradeMode = false) {
  if (!upgradeMode) {
    log("");
    log(`${BOLD}  db0 — the data layer that understands agents${RESET}`);
    log("");
  }

  const openclawDir = resolveOpenClawDir(explicitDir);
  const openclawConfig = join(openclawDir, "openclaw.json");
  const extensionsDir = join(openclawDir, "extensions");
  const displayDir = openclawDir.replace(homedir(), "~");

  if (!upgradeMode) {
    log(`  ${DIM}OpenClaw directory: ${displayDir}${RESET}`);
    log("");
  }

  // Check OpenClaw version — ContextEngine API requires >= v2026.3.7
  const MIN_OC_VERSION = "2026.3.7";
  let ocVersion: string | null = null;
  try {
    const raw = execSync("openclaw --version", { stdio: "pipe", encoding: "utf-8" }).trim();
    const match = raw.match(/(\d+\.\d+\.\d+)/);
    if (match) ocVersion = match[1];
  } catch {
    // openclaw not on PATH — skip version check, will be caught at runtime
  }
  if (ocVersion) {
    const v = ocVersion.split(".").map(Number);
    const m = MIN_OC_VERSION.split(".").map(Number);
    let tooOld = false;
    for (let i = 0; i < m.length; i++) {
      if ((v[i] || 0) > m[i]) break;
      if ((v[i] || 0) < m[i]) { tooOld = true; break; }
    }
    if (tooOld) {
      log(`  ${RED}${BOLD}OpenClaw ${ocVersion} is too old.${RESET}`);
      log(`  db0 requires OpenClaw ${BOLD}>= v${MIN_OC_VERSION}${RESET} for the ContextEngine API.`);
      log(`  Please upgrade OpenClaw first, then re-run this command.`);
      log("");
      process.exit(1);
    }
    log(`  ${GREEN}✓${RESET} OpenClaw ${BOLD}${ocVersion}${RESET} detected (>= v${MIN_OC_VERSION})`);
    if (!upgradeMode) log("");
  }

  ensureDir(openclawDir);
  ensureDir(extensionsDir);

  const db0ExtDir = join(extensionsDir, "db0");
  ensureDir(db0ExtDir);

  // Write the plugin manifest
  writeFileSync(
    join(db0ExtDir, "openclaw.plugin.json"),
    JSON.stringify(getManifest(), null, 2),
  );

  // Write the extension entry point
  const entryCode = `module.exports = {
  id: "db0",
  name: "db0 Memory & Context Engine",
  register(api) {
  const path = require("path");
  const os = require("os");
  const fs = require("fs");

  // === Capability detection ===
  // OpenClaw evolves fast (~daily releases). Detect what this version supports
  // so we degrade gracefully on older hosts instead of crashing.
  // Minimum version for full ContextEngine API: v2026.3.7
  const MIN_VERSION = "2026.3.7";
  const caps = {
    contextEngine: typeof api.registerContextEngine === "function",
    toolFactory:   typeof api.registerToolFactory === "function",
    tool:          typeof api.registerTool === "function",
    hook:          typeof api.registerHook === "function",
    getAgentId:    typeof api.getAgentId === "function",
    version:       typeof api.version === "string" ? api.version : null,
  };

  function versionAtLeast(ver, min) {
    if (!ver) return false;
    const v = ver.replace(/^v/, "").split(".").map(Number);
    const m = min.split(".").map(Number);
    for (let i = 0; i < m.length; i++) {
      if ((v[i] || 0) > m[i]) return true;
      if ((v[i] || 0) < m[i]) return false;
    }
    return true;
  }

  // Abort if ContextEngine API is not available — running on an OpenClaw version
  // that's too old will cause config validation errors (unrecognized contextEngine slot).
  if (!caps.contextEngine) {
    console.error(
      "[db0] FATAL: OpenClaw version does not support registerContextEngine (requires >= v" + MIN_VERSION + "). " +
      "Please upgrade OpenClaw and restart. db0 will not load."
    );
    return;
  }
  if (caps.version && !versionAtLeast(caps.version, MIN_VERSION)) {
    console.warn(
      "[db0] Warning: OpenClaw " + caps.version + " detected. ContextEngine API may be incomplete " +
      "(fully supported from v" + MIN_VERSION + "). Some lifecycle hooks may not fire."
    );
  }

  // Read db0-specific config from separate file (avoids OpenClaw Zod validation conflicts)
  const openclawDir = process.env.OPENCLAW_HOME || path.join(os.homedir(), ".openclaw");
  const db0ConfigPath = path.join(openclawDir, "extensions", "db0", "db0.config.json");
  let db0Config = {};
  try { db0Config = JSON.parse(fs.readFileSync(db0ConfigPath, "utf-8")); } catch {}

  // Also read openclaw.json for fallback API keys (agents.defaults.memorySearch.remote.apiKey)
  // OpenClaw uses JSON5 (unquoted keys, comments, trailing commas)
  const JSON5 = require("json5");
  let openclawConfig = {};
  try { openclawConfig = JSON5.parse(fs.readFileSync(path.join(openclawDir, "openclaw.json"), "utf-8")); } catch {}
  const memorySearch = openclawConfig?.agents?.defaults?.memorySearch;

  // Resolve embeddings config — merge db0.config.json with OpenClaw's memorySearch config
  function resolveEmbeddings() {
    let emb = db0Config.embeddings || "auto";
    if (memorySearch) {
      if (typeof emb === "string" && emb !== "hash" && emb !== "auto") {
        emb = {
          provider: emb,
          ...(memorySearch.model && { model: memorySearch.model }),
          ...(memorySearch.outputDimensionality && { dimensions: memorySearch.outputDimensionality }),
          ...(memorySearch.remote?.apiKey && { apiKey: memorySearch.remote.apiKey }),
        };
      }
      if (emb === "auto" && memorySearch.provider) {
        emb = {
          provider: memorySearch.provider,
          ...(memorySearch.model && { model: memorySearch.model }),
          ...(memorySearch.outputDimensionality && { dimensions: memorySearch.outputDimensionality }),
          ...(memorySearch.remote?.apiKey && { apiKey: memorySearch.remote.apiKey }),
        };
      }
      if (typeof emb === "object" && emb !== null && !emb.apiKey && memorySearch.remote?.apiKey) {
        emb = { ...emb, apiKey: memorySearch.remote.apiKey };
      }
    }
    return emb;
  }

  let db0Module = null;
  const engines = new Map();
  let engineCounter = 0;
  let latestEngine = null;

  // Resolve per-agent workspace from openclaw.json agents.list.
  // Re-reads config each call so newly added agents are picked up without restart.
  function resolveWorkspace(agentId) {
    let cfg = openclawConfig;
    try { cfg = JSON5.parse(fs.readFileSync(path.join(openclawDir, "openclaw.json"), "utf-8")); } catch {}
    const agents = cfg?.agents;
    if (agents?.list) {
      const agent = agents.list.find(a => a.id === agentId);
      if (agent?.workspace) return agent.workspace;
    }
    return (agents?.defaults?.workspace) || path.join(openclawDir, "workspace");
  }

  function createEngine() {
    if (!db0Module) {
      db0Module = require("@db0-ai/openclaw");
    }
    const agentId = caps.getAgentId ? api.getAgentId() : (db0Config.agentId || "main");
    const workspaceDir = resolveWorkspace(agentId);
    const embeddings = resolveEmbeddings();
    const engine = db0Module.db0({ memoryBackend: { workspaceDir }, embeddings, agentId });
    const engineId = String(++engineCounter);
    engine._db0EngineId = engineId;
    engines.set(engineId, engine);
    latestEngine = engine;
    const origBootstrap = engine.bootstrap.bind(engine);
    engine.bootstrap = async (params) => {
      engine._db0SessionId = params.sessionId;
      return origBootstrap(params);
    };
    return engine;
  }

  // === Context Engine registration ===
  try {
    api.registerContextEngine("db0", () => createEngine());
  } catch (err) {
    console.error("[db0] Failed to register context engine:", err.message || err);
    return;
  }

  // === Tool registration ===
  function resolveEngine(ctx) {
    if (ctx && ctx.sessionId) {
      for (const eng of engines.values()) {
        if (eng._db0SessionId === ctx.sessionId) return eng;
      }
    }
    return latestEngine;
  }

  const toolDefs = {
    memory_search: {
      name: "memory_search",
      label: "Memory Search",
      description: "Search indexed memory files (MEMORY.md, memory/*.md) using db0 semantic search",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "number", description: "Max results (default: 8)" },
        },
        required: ["query"],
      },
    },
    memory_get: {
      name: "memory_get",
      label: "Memory Get",
      description: "Read a specific memory file by path",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path (e.g. MEMORY.md or memory/2026-03-10.md)" },
          from: { type: "number", description: "Start line (1-indexed)" },
          lines: { type: "number", description: "Number of lines to read" },
        },
        required: ["path"],
      },
    },
    memory_status: {
      name: "memory_status",
      label: "Memory Status",
      description: "Check memory system status, including detected destructive overwrites of memory files",
      parameters: { type: "object", properties: {} },
    },
    memory_recover: {
      name: "memory_recover",
      label: "Memory Recover",
      description: "Replay db0 journal entries for crash/restart recovery",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Recovery reason label" },
        },
      },
    },
    memory_flush: {
      name: "memory_flush",
      label: "Memory Flush",
      description: "Force a db0 journal flush marker before risky operations",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Flush reason label" },
        },
      },
    },
    memory_rollback: {
      name: "memory_rollback",
      label: "Memory Rollback",
      description: "Restore a memory file from db0 snapshots",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path (e.g. MEMORY.md)" },
          contentHash: { type: "string", description: "Optional snapshot hash to restore" },
        },
        required: ["path"],
      },
    },
  };

  const toolHandlers = {
    async memory_search(engine, _toolCallId, params) {
      if (!engine || !engine.memoryBackend) {
        return { content: [{ type: "text", text: "Memory backend not initialized" }] };
      }
      const results = await engine.memoryBackend.search(params.query, {
        maxResults: params.limit,
      });
      const text = results.length === 0
        ? "No matching memories found."
        : results.map((r) =>
            \`[\${r.path}:\${r.startLine}-\${r.endLine}] (score: \${r.score.toFixed(2)})\\n\${r.snippet}\`
          ).join("\\n\\n");
      return { content: [{ type: "text", text }] };
    },
    async memory_get(engine, _toolCallId, params) {
      if (!engine || !engine.memoryBackend) {
        return { content: [{ type: "text", text: "Memory backend not initialized" }] };
      }
      const result = engine.memoryBackend.readFile({
        relPath: params.path,
        from: params.from,
        lines: params.lines,
      });
      return {
        content: [{ type: "text", text: result.text || "(empty)" }],
        details: { path: result.path },
      };
    },
    async memory_status(engine, _toolCallId, params) {
      if (!engine || !engine.memoryBackend) {
        return { content: [{ type: "text", text: "Memory backend not initialized" }] };
      }
      const overwrites = engine.memoryBackend.getOverwriteEvents();
      const lines = ["## Memory Status", ""];
      lines.push("Mode: " + MODE);
      if (overwrites.length === 0) {
        lines.push("No destructive overwrites detected.");
      } else {
        lines.push(\`**\${overwrites.length} destructive overwrite(s) detected:**\`);
        for (const o of overwrites) {
          lines.push(\`- \${o.relativePath}: \${o.previousLineCount} → \${o.currentLineCount} lines (\${o.lineDelta > 0 ? "+" : ""}\${o.lineDelta}) at \${o.detectedAt}\`);
        }
        lines.push("");
        lines.push("Pre-compaction snapshots were saved to db0. Use the inspector to review.");
      }
      return { content: [{ type: "text", text: lines.join("\\n") }] };
    },
    async memory_recover(engine, _toolCallId, params) {
      if (!engine || typeof engine.recover !== "function") {
        return { content: [{ type: "text", text: "Context engine not initialized" }] };
      }
      const out = await engine.recover(params?.reason || "manual-tool");
      return {
        content: [{ type: "text", text: out.ok
          ? \`Recovered \${out.importedMessages} message(s) from journal.\`
          : "Recovery failed." }],
        details: out,
      };
    },
    async memory_flush(engine, _toolCallId, params) {
      if (!engine || typeof engine.flush !== "function") {
        return { content: [{ type: "text", text: "Context engine not initialized" }] };
      }
      const out = await engine.flush(params?.reason || "manual-tool");
      return {
        content: [{ type: "text", text: out.ok
          ? "Flush marker written."
          : "Flush failed." }],
        details: out,
      };
    },
    async memory_rollback(engine, _toolCallId, params) {
      if (!engine || !engine.memoryBackend) {
        return { content: [{ type: "text", text: "Memory backend not initialized" }] };
      }
      const result = await engine.memoryBackend.rollbackFile({
        relPath: params.path,
        contentHash: params.contentHash,
      });
      const text = result.ok
        ? \`Restored \${result.relativePath} from snapshot \${result.restoredHash}.\`
        : \`Rollback failed: \${result.reason}\`;
      return { content: [{ type: "text", text }], details: result };
    },
  };

  if (caps.toolFactory) {
    for (const [name, def] of Object.entries(toolDefs)) {
      api.registerToolFactory(name, (ctx) => ({
        ...def,
        async execute(toolCallId, params) {
          const engine = resolveEngine(ctx);
          return toolHandlers[name](engine, toolCallId, params);
        },
      }));
    }
  } else if (caps.tool) {
    for (const [name, def] of Object.entries(toolDefs)) {
      api.registerTool({
        ...def,
        async execute(toolCallId, params) {
          const engine = resolveEngine();
          return toolHandlers[name](engine, toolCallId, params);
        },
      });
    }
  }

  // === Hook registration ===
  if (caps.hook) {
    const safeFlush = async (reason) => {
      if (latestEngine && typeof latestEngine.flush === "function") {
        try { await latestEngine.flush(reason); } catch {}
      }
    };
    try {
      api.registerHook("before_reset", async () => { await safeFlush("before_reset"); }, { name: "db0.before-reset" });
      api.registerHook("before_restart", async () => { await safeFlush("before_restart"); }, { name: "db0.before-restart" });
      api.registerHook("agent_end", async () => { await safeFlush("agent_end"); }, { name: "db0.agent-end" });
    } catch (err) {
      // Hook registration shape may differ across versions — non-fatal
      console.warn("[db0] Hook registration failed (non-fatal):", err.message || err);
    }
  }

  // === Background pre-indexing ===
  // On gateway restart, scan all agents' workspaces and index any memory files
  // that haven't been indexed yet. This avoids requiring each agent to have a
  // session before their memories appear in the inspector.
  setTimeout(async () => {
    try {
      let cfg;
      try { cfg = JSON5.parse(fs.readFileSync(path.join(openclawDir, "openclaw.json"), "utf-8")); } catch { return; }
      const agents = cfg?.agents?.list || [];
      const defaultWorkspace = (cfg?.agents?.defaults?.workspace) || path.join(openclawDir, "workspace");

      for (const agent of agents) {
        const agentId = agent.id;
        const workspace = agent.workspace || defaultWorkspace;

        // Check if workspace has memory files
        const hasMemoryMd = fs.existsSync(path.join(workspace, "MEMORY.md"));
        const hasMemoryDir = fs.existsSync(path.join(workspace, "memory"));
        if (!hasMemoryMd && !hasMemoryDir) continue;

        // Check if agent already has memories in the DB
        try {
          if (!db0Module) db0Module = require("@db0-ai/openclaw");
          const probe = db0Module.db0({ memoryBackend: { workspaceDir: workspace }, embeddings: resolveEmbeddings(), agentId });
          // Quick bootstrap with a synthetic session just to trigger file sync
          await probe.bootstrap({ sessionId: "__preindex_" + agentId, messages: [] });
          // assemble() awaits the deferred memory sync internally
          try { await probe.assemble({ messages: [], systemPrompt: "" }); } catch {}
          console.log("[db0] Pre-indexed workspace for agent: " + agentId);
          // Dispose engine — it was only used for indexing
          if (typeof probe.dispose === "function") probe.dispose();
        } catch (err) {
          console.warn("[db0] Pre-index failed for agent " + agentId + ":", err.message || err);
        }
      }
    } catch (e) {
      console.warn("[db0] Background pre-index scan failed:", e.message || e);
    }
  }, 3000);
  }
};
`;
  writeFileSync(join(db0ExtDir, "index.js"), entryCode);

  // In upgrade mode we only regenerate index.js — skip install and config
  if (upgradeMode) return;

  // Write package.json
  const extPkg = {
    name: "db0-openclaw-extension",
    version: "0.1.0",
    private: true,
    dependencies: { "@db0-ai/openclaw": "^0.1.0", "json5": "^2.2.3" },
  };
  writeFileSync(join(db0ExtDir, "package.json"), JSON.stringify(extPkg, null, 2));

  // Install
  log(`  ${BLUE}Installing${RESET} @db0-ai/openclaw...`);
  try {
    execSync("npm install --ignore-scripts", { cwd: db0ExtDir, stdio: "pipe" });
  } catch {
    log(`  Failed to install. Run manually: cd ${db0ExtDir} && npm install`);
    process.exit(1);
  }
  log(`  ${GREEN}✓${RESET} Installed extension to ${DIM}${displayDir}/extensions/db0${RESET}`);
  log("");

  // === Embedding provider selection ===
  const providers = await detectProviders();
  const available = providers.filter((p) => p.available);
  // Best available: first non-hash provider, or hash as fallback
  const best = available.find((p) => p.name !== "hash") ?? available[0];

  let chosenEmbedding: string = "hash";

  if (best.name !== "hash") {
    log(`  ${BOLD}Embedding provider${RESET}`);
    log("");
    for (const p of providers) {
      const marker = p.available ? `${GREEN}✓${RESET}` : `${DIM}✗${RESET}`;
      const rec = p.name === best.name ? ` ${YELLOW}← recommended${RESET}` : "";
      log(`    ${marker} ${BOLD}${p.name}${RESET} — ${DIM}${p.reason}${RESET}${rec}`);
    }
    log("");
    const answer = await prompt(
      `  Use ${BOLD}${best.label}${RESET} for embeddings? [Y/n] `,
    );
    if (!answer || answer.toLowerCase() === "y" || answer.toLowerCase() === "yes") {
      chosenEmbedding = best.name;
      log(`  ${GREEN}✓${RESET} Using ${BOLD}${best.label}${RESET} embeddings`);
    } else {
      // Let them pick
      const validNames = providers.map((p) => p.name);
      const pick = await prompt(
        `  Choose provider (${validNames.join(", ")}): `,
      );
      if (pick && validNames.includes(pick)) {
        chosenEmbedding = pick;
      }
      log(`  ${GREEN}✓${RESET} Using ${BOLD}${chosenEmbedding}${RESET} embeddings`);
    }
  } else {
    log(`  ${DIM}No LLM embedding provider detected. Using hash embeddings (zero-config).${RESET}`);
    log(`  ${DIM}Tip: Set GEMINI_API_KEY for free semantic embeddings, or run Ollama locally.${RESET}`);
  }

  // Update openclaw.json
  let config: Record<string, unknown> = {};
  if (existsSync(openclawConfig)) {
    try {
      config = JSON.parse(readFileSync(openclawConfig, "utf-8"));
    } catch {
      config = {};
    }
  }

  if (!config.plugins || typeof config.plugins !== "object") config.plugins = {};
  const plugins = config.plugins as Record<string, unknown>;

  if (!plugins.slots || typeof plugins.slots !== "object") plugins.slots = {};
  const slots = plugins.slots as Record<string, unknown>;
  slots.contextEngine = "db0";
  slots.memory = "db0";

  if (!plugins.entries || typeof plugins.entries !== "object") plugins.entries = {};
  const entries = plugins.entries as Record<string, unknown>;
  // Preserve existing db0 config, set embeddings from interactive choice
  const existingEntry = (entries["db0"] ?? {}) as Record<string, unknown>;
  entries["db0"] = { ...existingEntry, enabled: true };

  // Store db0-specific config separately (OpenClaw's Zod schema rejects unknown keys)
  const db0Cfg = readDb0Config(openclawDir);
  db0Cfg.embeddings = chosenEmbedding;
  writeDb0Config(openclawDir, db0Cfg);

  if (!plugins.allow) {
    plugins.allow = ["db0"];
  } else if (Array.isArray(plugins.allow) && !plugins.allow.includes("db0")) {
    plugins.allow.push("db0");
  }

  if (!config.hooks || typeof config.hooks !== "object") config.hooks = {};
  const hooks = config.hooks as Record<string, unknown>;
  if (!hooks.internal || typeof hooks.internal !== "object") hooks.internal = {};
  const internal = hooks.internal as Record<string, unknown>;
  if (!internal.entries || typeof internal.entries !== "object") internal.entries = {};
  const hookEntries = internal.entries as Record<string, unknown>;
  hookEntries["session-memory"] = { enabled: false };

  writeConfig(openclawDir, config);
  log(`  ${GREEN}✓${RESET} Updated ${DIM}${displayDir}/openclaw.json${RESET}`);
  log(`  ${GREEN}✓${RESET} Set memory slot to db0`);

  const dbPath = `${displayDir}/db0.sqlite`;
  log(`  ${GREEN}✓${RESET} Memory will be stored at ${DIM}${dbPath}${RESET}`);
  log("");
  log(`  ${GREEN}${BOLD}Ready.${RESET} Restart OpenClaw to activate db0.`);
  log("");
  log(`  ${DIM}Change later: npx @db0-ai/openclaw set embeddings <provider>${RESET}`);
  log("");
}

function set(args: CliArgs) {
  const key = args.subcommand;
  const value = args.positional[0];

  if (!key) {
    log("");
    log(`${BOLD}  db0 set${RESET} — configure db0 settings`);
    log("");
    log("  Usage:");
    log(`    npx @db0-ai/openclaw set embeddings <provider>  ${DIM}Set embedding provider${RESET}`);
    log(`    npx @db0-ai/openclaw set embeddings.model <name> ${DIM}Set embedding model${RESET}`);
    log(`    npx @db0-ai/openclaw set embeddings.baseUrl <url> ${DIM}Set custom endpoint${RESET}`);
    log("");
    log("  Embedding providers:");
    log(`    ${BOLD}hash${RESET}     ${DIM}Built-in hash embeddings (default, zero-config, instant)${RESET}`);
    log(`    ${BOLD}gemini${RESET}   ${DIM}Google Gemini (free tier, high quality, requires GEMINI_API_KEY)${RESET}`);
    log(`    ${BOLD}ollama${RESET}   ${DIM}Local Ollama server (free, private, good quality)${RESET}`);
    log(`    ${BOLD}openai${RESET}   ${DIM}OpenAI API (best quality, requires OPENAI_API_KEY)${RESET}`);
    log("");
    log("  Examples:");
    log(`    npx @db0-ai/openclaw set embeddings ollama`);
    log(`    npx @db0-ai/openclaw set embeddings openai`);
    log(`    npx @db0-ai/openclaw set embeddings.model mxbai-embed-large`);
    log(`    npx @db0-ai/openclaw set embeddings.baseUrl http://192.168.1.100:11434`);
    log("");
    return;
  }

  const openclawDir = resolveOpenClawDir(args.dir);
  const displayDir = openclawDir.replace(homedir(), "~");

  // db0 settings are stored in db0.config.json (not openclaw.json) to avoid
  // OpenClaw's Zod validation rejecting unknown keys.
  const db0Cfg = readDb0Config(openclawDir);

  if (key === "embeddings") {
    if (!value) {
      log(`${RED}  Error: missing value. Usage: set embeddings <hash|ollama|openai|gemini>${RESET}`);
      process.exit(1);
    }
    const validProviders = ["hash", "ollama", "openai", "gemini"];
    if (!validProviders.includes(value)) {
      log(`${RED}  Error: unknown provider "${value}". Choose: ${validProviders.join(", ")}${RESET}`);
      process.exit(1);
    }
    db0Cfg.embeddings = value;
  } else if (key.startsWith("embeddings.")) {
    const subKey = key.slice("embeddings.".length);
    if (!value) {
      log(`${RED}  Error: missing value. Usage: set ${key} <value>${RESET}`);
      process.exit(1);
    }
    let embConfig: Record<string, unknown>;
    if (typeof db0Cfg.embeddings === "string") {
      embConfig = { provider: db0Cfg.embeddings };
    } else if (typeof db0Cfg.embeddings === "object" && db0Cfg.embeddings !== null) {
      embConfig = db0Cfg.embeddings as Record<string, unknown>;
    } else {
      embConfig = { provider: "hash" };
    }
    embConfig[subKey] = value;
    db0Cfg.embeddings = embConfig;
  } else if (key === "agentId") {
    if (!value) {
      log(`${RED}  Error: missing value. Usage: set agentId <name>${RESET}`);
      process.exit(1);
    }
    db0Cfg.agentId = value;
  } else {
    log(`${RED}  Error: unknown setting "${key}"${RESET}`);
    log(`  ${DIM}Available: embeddings, embeddings.model, embeddings.baseUrl, agentId${RESET}`);
    process.exit(1);
  }

  writeDb0Config(openclawDir, db0Cfg);

  log("");
  log(`  ${GREEN}✓${RESET} Updated ${DIM}${displayDir}/extensions/db0/db0.config.json${RESET}`);

  // Show what was set
  const current = db0Cfg.embeddings;
  if (typeof current === "string") {
    log(`  ${BOLD}embeddings${RESET} = ${current}`);
  } else if (typeof current === "object" && current !== null) {
    const obj = current as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      log(`  ${BOLD}embeddings.${k}${RESET} = ${v}`);
    }
  }

  // Provider-specific tips
  const provider = typeof current === "string" ? current
    : (current as Record<string, unknown>)?.provider;

  if (provider === "gemini") {
    const geminiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY ?? process.env.GOOGLE_API_KEY;
    if (!geminiKey) {
      log("");
      log(`  ${YELLOW}Note:${RESET} Set your API key: export GEMINI_API_KEY=...`);
      log(`  ${DIM}Get a free key at https://aistudio.google.com/apikey${RESET}`);
    }
  } else if (provider === "ollama") {
    const model = typeof current === "object"
      ? ((current as Record<string, unknown>).model as string) ?? "nomic-embed-text"
      : "nomic-embed-text";
    log("");
    log(`  ${YELLOW}Note:${RESET} Make sure Ollama is running with the model pulled:`);
    log(`    ollama pull ${model}`);
  } else if (provider === "openai") {
    if (!process.env.OPENAI_API_KEY) {
      log("");
      log(`  ${YELLOW}Note:${RESET} Set your API key: export OPENAI_API_KEY=sk-...`);
    }
  }

  log("");
  log(`  ${DIM}Restart OpenClaw to apply changes.${RESET}`);
  log("");
}

function get(args: CliArgs) {
  const openclawDir = resolveOpenClawDir(args.dir);
  const db0Cfg = readDb0Config(openclawDir);
  const displayDir = openclawDir.replace(homedir(), "~");
  const key = args.subcommand;

  log("");
  log(`  ${DIM}Config: ${displayDir}/extensions/db0/db0.config.json${RESET}`);
  log("");

  if (key) {
    // Show specific key
    if (key === "embeddings") {
      const emb = db0Cfg.embeddings ?? "hash (default)";
      if (typeof emb === "string") {
        log(`  ${BOLD}embeddings${RESET} = ${emb}`);
      } else if (typeof emb === "object" && emb !== null) {
        for (const [k, v] of Object.entries(emb as Record<string, unknown>)) {
          log(`  ${BOLD}embeddings.${k}${RESET} = ${v}`);
        }
      }
    } else {
      const val = db0Cfg[key];
      log(`  ${BOLD}${key}${RESET} = ${val !== undefined ? JSON.stringify(val) : "(not set)"}`);
    }
  } else {
    // Show all db0 settings
    if (Object.keys(db0Cfg).length === 0) {
      log(`  ${DIM}No db0 settings configured. Using defaults.${RESET}`);
    } else {
      for (const [k, v] of Object.entries(db0Cfg)) {
        if (k === "embeddings" && typeof v === "object" && v !== null) {
          for (const [ek, ev] of Object.entries(v as Record<string, unknown>)) {
            log(`  ${BOLD}embeddings.${ek}${RESET} = ${ev}`);
          }
        } else {
          log(`  ${BOLD}${k}${RESET} = ${typeof v === "string" ? v : JSON.stringify(v)}`);
        }
      }
    }
  }
  log("");
}

function status(args: CliArgs) {
  const openclawDir = resolveOpenClawDir(args.dir);
  const config = readConfig(openclawDir);
  const entry = getDb0Entry(config);
  const displayDir = openclawDir.replace(homedir(), "~");

  const plugins = (config.plugins ?? {}) as Record<string, unknown>;
  const slots = (plugins.slots ?? {}) as Record<string, unknown>;

  log("");
  log(`${BOLD}  db0 status${RESET}`);
  log("");
  log(`  OpenClaw dir:     ${displayDir}`);
  log(`  Context engine:   ${slots.contextEngine === "db0" ? `${GREEN}db0${RESET}` : `${DIM}${slots.contextEngine ?? "default"}${RESET}`}`);
  log(`  Memory slot:      ${slots.memory === "db0" ? `${GREEN}db0${RESET}` : `${DIM}${slots.memory ?? "default"}${RESET}`}`);

  // Embeddings (read from db0.config.json)
  const db0Cfg = readDb0Config(openclawDir);
  const emb = db0Cfg.embeddings;
  const provider = typeof emb === "string" ? emb
    : typeof emb === "object" && emb !== null ? (emb as Record<string, unknown>).provider as string
    : "hash";
  const model = typeof emb === "object" && emb !== null
    ? (emb as Record<string, unknown>).model as string
    : undefined;
  log(`  Embeddings:       ${BOLD}${provider ?? "hash"}${RESET}${model ? ` (${model})` : ""}`);

  // DB file
  const dbPath = join(openclawDir, "db0.sqlite");
  if (existsSync(dbPath)) {
    const { size } = statSync(dbPath);
    const sizeKb = (size / 1024).toFixed(0);
    log(`  Database:         ${displayDir}/db0.sqlite (${sizeKb} KB)`);
  } else {
    log(`  Database:         ${DIM}not created yet${RESET}`);
  }

  // Extension
  const extDir = join(openclawDir, "extensions", "db0");
  log(`  Extension:        ${existsSync(join(extDir, "index.js")) ? `${GREEN}installed${RESET}` : `${RED}not found${RESET}`}`);

  log("");
}

// === Upgrade command ===

async function upgrade(args: CliArgs) {
  const target = args.subcommand ?? "openclaw"; // "openclaw", "claude-code", or "all"

  log("");
  log(`${BOLD}  db0 upgrade${RESET}`);
  log("");

  if (target === "openclaw" || target === "all") {
    await upgradeOpenClaw(args);
  }

  if (target === "claude-code" || target === "all") {
    upgradeClaudeCode();
  }

  if (target !== "openclaw" && target !== "claude-code" && target !== "all") {
    log(`${RED}  Unknown target: ${target}${RESET}`);
    log(`  ${DIM}Usage: db0-openclaw upgrade [openclaw|claude-code|all]${RESET}`);
    process.exit(1);
  }

  log(`  ${DIM}Restart the host application to apply changes.${RESET}`);
  log("");
}

async function upgradeOpenClaw(args: CliArgs) {
  const openclawDir = resolveOpenClawDir(args.dir);
  const displayDir = openclawDir.replace(homedir(), "~");
  const db0ExtDir = join(openclawDir, "extensions", "db0");

  if (!existsSync(join(db0ExtDir, "index.js"))) {
    log(`  ${YELLOW}OpenClaw plugin not installed. Run 'init' first.${RESET}`);
    return;
  }

  log(`  ${BLUE}Upgrading${RESET} @db0-ai/openclaw...`);

  let oldVersion: string | undefined;
  try {
    const pkgPath = join(db0ExtDir, "node_modules", "@db0-ai", "openclaw", "package.json");
    if (existsSync(pkgPath)) {
      oldVersion = JSON.parse(readFileSync(pkgPath, "utf-8")).version;
    }
  } catch {}

  // Update manifest
  writeFileSync(
    join(db0ExtDir, "openclaw.plugin.json"),
    JSON.stringify(getManifest(), null, 2),
  );

  // Update package.json to latest
  const extPkg = {
    name: "db0-openclaw-extension",
    version: "0.1.0",
    private: true,
    dependencies: { "@db0-ai/openclaw": "latest", "json5": "^2.2.3" },
  };
  writeFileSync(join(db0ExtDir, "package.json"), JSON.stringify(extPkg, null, 2));

  try {
    execSync("npm install --ignore-scripts", { cwd: db0ExtDir, stdio: "pipe" });
  } catch {
    log(`  ${RED}Failed to install. Run manually: cd ${db0ExtDir} && npm install${RESET}`);
    return;
  }

  // Re-generate the entry point (picks up any new tool registrations, etc.)
  await init(args.dir, true);

  let newVersion: string | undefined;
  try {
    const pkgPath = join(db0ExtDir, "node_modules", "@db0-ai", "openclaw", "package.json");
    if (existsSync(pkgPath)) {
      newVersion = JSON.parse(readFileSync(pkgPath, "utf-8")).version;
    }
  } catch {}

  log(`  ${GREEN}✓${RESET} Upgraded OpenClaw plugin${oldVersion && newVersion ? ` (${oldVersion} → ${newVersion})` : ""}`);
  log("");
}

function upgradeClaudeCode() {
  if (!isClaudeCodeInstalled()) {
    log(`  ${YELLOW}Claude Code MCP server not configured. Installing...${RESET}`);
    installClaudeCodeMcp();
    log(`  ${GREEN}✓${RESET} Installed db0 MCP server in ${DIM}~/.claude/settings.json${RESET}`);
  } else {
    // MCP server uses npx -y which auto-fetches latest — just confirm config is current
    installClaudeCodeMcp();
    log(`  ${GREEN}✓${RESET} Updated Claude Code MCP server config`);
  }

  // Clear npx cache for @db0-ai/claude-code so next invocation fetches latest
  try {
    execSync("npx -y --package=@db0-ai/claude-code@latest db0-mcp-server --version", {
      stdio: "pipe",
      timeout: 30000,
    });
  } catch {
    // Best-effort cache refresh
  }

  log(`  ${DIM}The MCP server will use the latest version on next Claude Code launch.${RESET}`);
  log("");
}

// === Uninstall command ===

async function uninstall(args: CliArgs) {
  const target = args.subcommand ?? "openclaw"; // "openclaw", "claude-code", or "all"

  log("");
  log(`${BOLD}  db0 uninstall${RESET}`);
  log("");

  if (target !== "openclaw" && target !== "claude-code" && target !== "all") {
    log(`${RED}  Unknown target: ${target}${RESET}`);
    log(`  ${DIM}Usage: db0-openclaw uninstall [openclaw|claude-code|all]${RESET}`);
    process.exit(1);
  }

  // Confirm unless --force
  if (args.flags["force"] !== true) {
    const label = target === "all" ? "OpenClaw and Claude Code" : target === "claude-code" ? "Claude Code" : "OpenClaw";
    const answer = await prompt(`  Remove db0 from ${label}? [y/N] `);
    if (!answer || (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes")) {
      log(`  ${DIM}Cancelled.${RESET}`);
      log("");
      return;
    }
  }

  if (target === "openclaw" || target === "all") {
    await uninstallOpenClaw(args);
  }

  if (target === "claude-code" || target === "all") {
    uninstallClaudeCode();
  }

  log(`  ${GREEN}${BOLD}Done.${RESET} Restart the host application to apply.`);
  log("");
}

async function uninstallOpenClaw(args: CliArgs) {
  const openclawDir = resolveOpenClawDir(args.dir);
  const displayDir = openclawDir.replace(homedir(), "~");
  const db0ExtDir = join(openclawDir, "extensions", "db0");
  const keepData = args.flags["keep-data"] === true;

  if (!existsSync(db0ExtDir)) {
    log(`  ${DIM}OpenClaw plugin not found at ${displayDir}/extensions/db0${RESET}`);
    return;
  }

  // Remove extension directory
  try {
    rmSync(db0ExtDir, { recursive: true, force: true });
    log(`  ${GREEN}✓${RESET} Removed ${DIM}${displayDir}/extensions/db0${RESET}`);
  } catch (err) {
    log(`  ${RED}Failed to remove extension directory: ${(err as Error).message}${RESET}`);
  }

  // Clean openclaw.json
  try {
    const config = readConfig(openclawDir);
    const plugins = (config.plugins ?? {}) as Record<string, unknown>;
    const slots = (plugins.slots ?? {}) as Record<string, unknown>;
    const entries = (plugins.entries ?? {}) as Record<string, unknown>;

    if (slots.contextEngine === "db0") delete slots.contextEngine;
    if (slots.memory === "db0") delete slots.memory;
    delete entries["db0"];

    if (Array.isArray(plugins.allow)) {
      plugins.allow = plugins.allow.filter((p: unknown) => p !== "db0");
    }

    writeConfig(openclawDir, config);
    log(`  ${GREEN}✓${RESET} Cleaned ${DIM}${displayDir}/openclaw.json${RESET}`);
  } catch {
    log(`  ${YELLOW}Warning: could not clean openclaw.json${RESET}`);
  }

  // Remove database unless --keep-data
  if (!keepData) {
    const dbPath = join(openclawDir, "db0.sqlite");
    if (existsSync(dbPath)) {
      try {
        rmSync(dbPath);
        log(`  ${GREEN}✓${RESET} Removed ${DIM}${displayDir}/db0.sqlite${RESET}`);
      } catch (err) {
        log(`  ${YELLOW}Warning: could not remove database: ${(err as Error).message}${RESET}`);
      }
    }
    for (const suffix of ["-wal", "-shm"]) {
      const walPath = join(openclawDir, `db0.sqlite${suffix}`);
      if (existsSync(walPath)) {
        try { rmSync(walPath); } catch {}
      }
    }
  } else {
    log(`  ${DIM}Kept database at ${displayDir}/db0.sqlite${RESET}`);
  }
}

function uninstallClaudeCode() {
  if (!isClaudeCodeInstalled()) {
    log(`  ${DIM}Claude Code MCP server not configured — nothing to remove.${RESET}`);
    return;
  }

  removeClaudeCodeMcp();
  log(`  ${GREEN}✓${RESET} Removed db0 MCP server from ${DIM}~/.claude/settings.json${RESET}`);

  // Remove Claude Code db0 database if it exists
  const ccDbPath = join(CLAUDE_CODE_DIR, "db0.sqlite");
  if (existsSync(ccDbPath)) {
    try {
      rmSync(ccDbPath);
      log(`  ${GREEN}✓${RESET} Removed ${DIM}~/.claude/db0.sqlite${RESET}`);
      for (const suffix of ["-wal", "-shm"]) {
        const p = ccDbPath + suffix;
        if (existsSync(p)) { try { rmSync(p); } catch {} }
      }
    } catch (err) {
      log(`  ${YELLOW}Warning: could not remove database: ${(err as Error).message}${RESET}`);
    }
  }
}

// === Restore command ===

async function restore(args: CliArgs) {
  const openclawDir = resolveOpenClawDir(args.dir);
  const db0Cfg = readDb0Config(openclawDir);
  const workspaceDir = join(openclawDir, "workspace");
  const isForce = args.flags["force"] === true;
  const isDryRun = args.flags["dry-run"] === true;
  const filterFiles = args.subcommand ? [args.subcommand, ...args.positional] : undefined;

  log("");
  log(`${BOLD}  db0 restore${RESET}${isDryRun ? ` ${DIM}(dry run)${RESET}` : ""}`);
  log("");

  // 1. Resolve storage backend
  const storage = (db0Cfg.storage as string | undefined) ?? undefined;
  if (!storage || !(storage.startsWith("postgresql://") || storage.startsWith("postgres://"))) {
    // Check if there's a local SQLite DB
    const sqlitePath = join(openclawDir, "db0.sqlite");
    if (!existsSync(sqlitePath) && !storage) {
      log(`  ${RED}No backend configured.${RESET}`);
      log(`  Restore requires a backend with existing snapshots.`);
      log(`  For hosted PG: ${DIM}db0-openclaw set storage postgresql://...${RESET}`);
      log("");
      process.exit(1);
    }
  }

  log(`  ${DIM}Connecting to backend...${RESET}`);

  // 2. Create a temporary context engine to access the backend
  let engine;
  try {
    const { db0 } = await import("./context-engine.js");
    const { createEmbeddingFn, deriveEmbeddingId, autoDetectProvider } = await import("./embeddings.js");

    // Resolve embeddings config (same logic as index.js)
    let embeddings = db0Cfg.embeddings ?? "auto";

    engine = db0({
      storage: storage ?? join(openclawDir, "db0.sqlite"),
      memoryBackend: { workspaceDir },
      embeddings: embeddings as any,
      agentId: (db0Cfg.agentId as string) ?? "main",
    });

    // Bootstrap to initialize backend + memory backend
    await engine.bootstrap({
      sessionId: `restore-${Date.now()}`,
      sessionFile: join(openclawDir, "sessions", "restore.jsonl"),
    });
  } catch (err) {
    log(`  ${RED}Failed to connect to backend:${RESET} ${err instanceof Error ? err.message : err}`);
    log("");
    process.exit(1);
  }

  if (!engine.memoryBackend) {
    log(`  ${RED}Memory backend not initialized.${RESET}`);
    log(`  Ensure workspace directory exists: ${workspaceDir}`);
    log("");
    // Try creating it and retrying
    if (!existsSync(workspaceDir)) {
      mkdirSync(workspaceDir, { recursive: true });
      log(`  ${GREEN}Created${RESET} ${workspaceDir}`);
      log(`  Please re-run: ${DIM}db0-openclaw restore${RESET}`);
    }
    await engine.dispose?.();
    process.exit(1);
  }

  // 3. List available snapshots
  const snapshots = await engine.memoryBackend.listSnapshots();

  if (snapshots.length === 0) {
    log(`  ${YELLOW}No snapshots found in backend.${RESET}`);
    log("");
    log(`  Snapshots are created automatically before compaction events.`);
    log(`  If this is a fresh install, there's nothing to restore yet.`);
    log("");
    await engine.dispose?.();
    return;
  }

  // Filter if specific files requested
  const toShow = filterFiles
    ? snapshots.filter((s) => filterFiles.includes(s.relativePath))
    : snapshots;

  if (filterFiles && toShow.length === 0) {
    log(`  ${YELLOW}No snapshots found for:${RESET} ${filterFiles.join(", ")}`);
    log("");
    log(`  Available files:`);
    for (const s of snapshots) {
      log(`    ${s.relativePath}`);
    }
    log("");
    await engine.dispose?.();
    return;
  }

  // 4. Show what's available and what will happen
  log(`  ${BOLD}Found ${toShow.length} file(s) with snapshots:${RESET}`);
  log("");

  let restorableCount = 0;
  let skipCount = 0;

  for (const snap of toShow) {
    const absPath = resolve(workspaceDir, snap.relativePath);
    const localExists = existsSync(absPath) && readFileSync(absPath, "utf-8").trim().length > 0;
    const age = timeSince(new Date(snap.latestAt));

    if (localExists && !isForce) {
      log(`  ${DIM}  skip${RESET}  ${snap.relativePath}  ${DIM}(exists locally, ${snap.lineCount} lines)${RESET}`);
      skipCount++;
    } else if (localExists && isForce) {
      log(`  ${YELLOW}  overwrite${RESET}  ${snap.relativePath}  ${DIM}${snap.lineCount} lines, snapshot ${age} ago, ${snap.snapshotCount} version(s)${RESET}`);
      restorableCount++;
    } else {
      log(`  ${GREEN}  restore${RESET}   ${snap.relativePath}  ${DIM}${snap.lineCount} lines, snapshot ${age} ago, ${snap.snapshotCount} version(s)${RESET}`);
      restorableCount++;
    }
  }

  log("");

  if (restorableCount === 0) {
    log(`  ${GREEN}All files already exist locally. Nothing to restore.${RESET}`);
    if (skipCount > 0) {
      log(`  ${DIM}Use --force to overwrite existing files from snapshots.${RESET}`);
    }
    log("");
    await engine.dispose?.();
    return;
  }

  if (isDryRun) {
    log(`  ${BLUE}Dry run — ${restorableCount} file(s) would be restored.${RESET}`);
    log(`  ${DIM}Remove --dry-run to proceed.${RESET}`);
    log("");
    await engine.dispose?.();
    return;
  }

  // 5. Confirm
  if (!isForce && restorableCount > 0) {
    const answer = await prompt(`  Restore ${restorableCount} file(s)? [Y/n] `);
    if (answer.toLowerCase() === "n" || answer.toLowerCase() === "no") {
      log(`  ${DIM}Cancelled.${RESET}`);
      log("");
      await engine.dispose?.();
      return;
    }
  }

  // 6. Execute restore
  log("");
  log(`  ${DIM}Restoring...${RESET}`);

  // Ensure workspace + memory subdirectory exist
  mkdirSync(join(workspaceDir, "memory"), { recursive: true });

  const filesToRestore = isForce
    ? toShow.map((s) => s.relativePath)
    : toShow
        .filter((s) => {
          const absPath = resolve(workspaceDir, s.relativePath);
          return !existsSync(absPath) || readFileSync(absPath, "utf-8").trim().length === 0;
        })
        .map((s) => s.relativePath);

  const result = await engine.memoryBackend.restoreWorkspace(filesToRestore);

  // 7. Show results
  log("");
  for (const r of result.restored) {
    log(`  ${GREEN}  ✓${RESET} ${r.relativePath}  ${DIM}(${r.lines} lines)${RESET}`);
  }
  for (const s of result.skipped) {
    log(`  ${DIM}  – ${s.relativePath} (${s.reason})${RESET}`);
  }
  for (const f of result.failed) {
    log(`  ${RED}  ✗ ${f.relativePath}: ${f.error}${RESET}`);
  }

  log("");
  if (result.restored.length > 0) {
    log(`  ${GREEN}${BOLD}Restored ${result.restored.length} file(s).${RESET}`);
  }
  if (result.failed.length > 0) {
    log(`  ${RED}${result.failed.length} file(s) failed.${RESET}`);
  }
  log("");

  await engine.dispose?.();
}

function timeSince(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function showHelp() {
  log("");
  log(`${BOLD}  db0${RESET} — the data layer that understands agents`);
  log("");
  log("  Usage:");
  log(`    npx @db0-ai/openclaw <command> [options]`);
  log("");
  log("  Commands:");
  log(`    ${BOLD}init${RESET}                          Install db0 plugin for OpenClaw`);
  log(`    ${BOLD}upgrade${RESET} [target]               Upgrade db0 to latest version`);
  log(`    ${BOLD}uninstall${RESET} [target]             Remove db0 plugin and data`);
  log(`    ${BOLD}set${RESET} <key> <value>              Update a db0 setting`);
  log(`    ${BOLD}get${RESET} [key]                      Show db0 settings`);
  log(`    ${BOLD}status${RESET}                         Show db0 status and health`);
  log(`    ${BOLD}restore${RESET} [files...]             Restore workspace from backend snapshots`);
  log("");
  log("  Quick start:");
  log(`    npx @db0-ai/openclaw init`);
  log(`    npx @db0-ai/openclaw set embeddings ollama`);
  log(`    ollama pull nomic-embed-text`);
  log("");
  log("  Restore options:");
  log(`    db0-openclaw restore                    Restore all missing files`);
  log(`    db0-openclaw restore MEMORY.md          Restore specific file(s)`);
  log(`    db0-openclaw restore --dry-run          Preview what would be restored`);
  log(`    db0-openclaw restore --force            Overwrite existing files`);
  log("");
  log("  Upgrade/uninstall targets:");
  log(`    db0-openclaw upgrade                    Upgrade OpenClaw plugin (default)`);
  log(`    db0-openclaw upgrade claude-code        Upgrade Claude Code MCP server`);
  log(`    db0-openclaw upgrade all                Upgrade both`);
  log(`    db0-openclaw uninstall                  Remove OpenClaw plugin and data`);
  log(`    db0-openclaw uninstall claude-code      Remove Claude Code MCP server`);
  log(`    db0-openclaw uninstall all              Remove both`);
  log(`    db0-openclaw uninstall --keep-data      Remove plugin but keep database`);
  log(`    db0-openclaw uninstall --force          Skip confirmation prompt`);
  log("");
  log("  Options:");
  log(`    --dir <path>                  OpenClaw directory (default: auto-detect)`);
  log("");
}

// === Entry point ===

const args = parseArgs(process.argv.slice(2));

async function main() {
  switch (args.command) {
    case "init":
      await init(args.dir);
      break;
    case "upgrade":
      await upgrade(args);
      break;
    case "uninstall":
      await uninstall(args);
      break;
    case "set":
      set(args);
      break;
    case "get":
      get(args);
      break;
    case "status":
      status(args);
      break;
    case "restore":
      await restore(args);
      break;
    case "help":
    case "--help":
    case "-h":
      showHelp();
      break;
    default:
      if (!args.command) {
        showHelp();
      } else {
        log(`${RED}  Unknown command: ${args.command}${RESET}`);
        showHelp();
        process.exit(1);
      }
  }
}

main().catch((err) => {
  console.error(`${RED}  Error: ${err.message}${RESET}`);
  process.exit(1);
});
