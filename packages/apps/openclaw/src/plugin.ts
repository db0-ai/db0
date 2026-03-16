/**
 * OpenClaw plugin entry point for `openclaw plugins install @db0-ai/openclaw`.
 *
 * Referenced by the `openclaw.extensions` field in package.json.
 * Exports the plugin registration object that OpenClaw's plugin loader expects.
 */

import { db0 } from "./context-engine.js";
import type { EmbeddingProvider } from "./embeddings.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const MIN_VERSION = "2026.3.7";

function versionAtLeast(ver: string, min: string): boolean {
  const v = ver.replace(/^v/, "").split(".").map(Number);
  const m = min.split(".").map(Number);
  for (let i = 0; i < m.length; i++) {
    if ((v[i] || 0) > m[i]) return true;
    if ((v[i] || 0) < m[i]) return false;
  }
  return true;
}

interface PluginApi {
  registerContextEngine: (id: string, factory: () => unknown) => void;
  getAgentId?: () => string;
  version?: string;
}

export default {
  id: "db0",
  name: "db0 Memory & Context Engine",

  register(api: PluginApi) {
    // Version gate
    if (typeof api.registerContextEngine !== "function") {
      console.error(
        `[db0] FATAL: OpenClaw does not support registerContextEngine (requires >= v${MIN_VERSION}). db0 will not load.`,
      );
      return;
    }
    if (api.version && !versionAtLeast(api.version, MIN_VERSION)) {
      console.warn(
        `[db0] Warning: OpenClaw ${api.version} detected. ContextEngine API may be incomplete (fully supported from v${MIN_VERSION}).`,
      );
    }

    // Resolve config
    const openclawDir = process.env.OPENCLAW_HOME || join(homedir(), ".openclaw");
    const db0ConfigPath = join(openclawDir, "extensions", "db0", "db0.config.json");
    let db0Config: Record<string, unknown> = {};
    try {
      db0Config = JSON.parse(readFileSync(db0ConfigPath, "utf-8"));
    } catch {
      // No config file — use defaults
    }

    // Resolve embeddings provider (synchronous — auto-detect happens during `init`)
    const configured = (db0Config.embeddings as string) ?? "hash";
    const provider: EmbeddingProvider = configured === "auto"
      ? "hash"
      : configured as EmbeddingProvider;

    const workspaceDir = join(openclawDir, "workspace");
    const agentId = (db0Config.agentId as string) ?? (api.getAgentId ? api.getAgentId() : "main");

    // Register context engine
    try {
      api.registerContextEngine("db0", () =>
        db0({
          memoryBackend: { workspaceDir },
          embeddings: provider,
          agentId,
        }),
      );
    } catch (err) {
      console.error("[db0] Failed to register context engine:", err);
    }
  },
};
