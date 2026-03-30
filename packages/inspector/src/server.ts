import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { defaultEmbeddingFn } from "@db0-ai/core";
import type { InspectorConfig } from "./index.js";
import {
  listMemories,
  getMemory,
  getSupersedChain,
  correctMemory,
  confirmMemory,
  deleteMemory,
  searchMemories,
  getStats,
  explainMemory,
  getIntegrityReport,
  getConsolidationCandidates,
  getConsolidationHistory,
  exportMemories,
  importMemories,
  type ApiContext,
} from "./api.js";
import { INSPECTOR_HTML } from "./ui.js";

interface RuntimeInfo {
  profile: "generic" | "openclaw" | "claude-code";
  workspaceDir?: string;
  sessionFile?: string;
  memoryModel?: string;
  capabilities: {
    hasExplainApi: boolean;
    hasIntegrityApi: boolean;
    supportsFileSnapshots: boolean;
    supportsFileRollback: boolean;
    supportsJournalRecovery: boolean;
    supportsContradictionLinks: boolean;
  };
  config?: import("./index.js").InspectorDisplayConfig;
}

export class InspectorServer {
  private server: Server | null = null;
  private config: InspectorConfig;
  private ctx: ApiContext;
  private runtime: RuntimeInfo;

  constructor(config: InspectorConfig) {
    this.config = config;
    this.ctx = {
      backend: config.backend,
      agentId: config.agentId,
      userId: config.userId,
      embeddingFn: config.embeddingFn ?? defaultEmbeddingFn,
    };
    const configuredProfile = config.runtime?.profile ?? "generic";
    const runtimeProfile = configuredProfile === "claude"
      ? "claude-code"
      : configuredProfile;
    this.runtime = {
      profile: runtimeProfile,
      workspaceDir: config.runtime?.workspaceDir,
      sessionFile: config.runtime?.sessionFile,
      memoryModel: config.runtime?.memoryModel ?? (
        runtimeProfile === "openclaw"
          ? "OpenClaw ContextEngine + scoped durable memories + compaction safety snapshots"
          : runtimeProfile === "claude-code"
            ? "Claude Code MCP memory/state/log tools backed by db0 harness"
          : "Generic db0 memory backend"
      ),
      capabilities: {
        hasExplainApi: config.runtime?.capabilities?.hasExplainApi ?? true,
        hasIntegrityApi: config.runtime?.capabilities?.hasIntegrityApi ?? true,
        supportsFileSnapshots: config.runtime?.capabilities?.supportsFileSnapshots ?? (runtimeProfile === "openclaw"),
        supportsFileRollback: config.runtime?.capabilities?.supportsFileRollback ?? (runtimeProfile === "openclaw"),
        supportsJournalRecovery: config.runtime?.capabilities?.supportsJournalRecovery ?? (runtimeProfile === "openclaw"),
        supportsContradictionLinks: config.runtime?.capabilities?.supportsContradictionLinks ?? (runtimeProfile === "openclaw"),
      },
      config: config.runtime?.config,
    };
  }

  async start(): Promise<{ url: string }> {
    const host = this.config.host ?? "127.0.0.1";
    const port = this.config.port ?? 6460;

    this.server = createServer((req, res) => this.handleRequest(req, res));

    return new Promise((resolve, reject) => {
      this.server!.listen(port, host, () => {
        const url = `http://${host}:${port}`;
        resolve({ url });
      });
      this.server!.on("error", reject);
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse) {
    // Auth check
    if (this.config.token) {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${this.config.token}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const path = url.pathname;
    const method = req.method ?? "GET";

    try {
      // Serve UI
      if (path === "/" && method === "GET") {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
        });
        res.end(INSPECTOR_HTML);
        return;
      }

      // API routes
      if (path.startsWith("/api/")) {
        res.setHeader("Content-Type", "application/json");
        await this.handleApi(method, path, url, req, res);
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
      }
      res.end(JSON.stringify({ error: message }));
    }
  }

  private async handleApi(
    method: string,
    path: string,
    url: URL,
    req: IncomingMessage,
    res: ServerResponse,
  ) {
    // GET /api/stats
    if (path === "/api/stats" && method === "GET") {
      const stats = await getStats(this.ctx);
      res.writeHead(200);
      res.end(JSON.stringify(stats));
      return;
    }

    // GET /api/runtime
    if (path === "/api/runtime" && method === "GET") {
      res.writeHead(200);
      res.end(JSON.stringify(this.runtime));
      return;
    }

    // POST /api/switch-agent — switch to a different agent
    if (path === "/api/switch-agent" && method === "POST") {
      const body = await readBody(req);
      const newAgentId = body.agentId;
      if (!newAgentId || typeof newAgentId !== "string") {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "agentId required" }));
        return;
      }
      this.ctx.agentId = newAgentId;
      if (this.runtime.config) {
        this.runtime.config.agentId = newAgentId;
      }
      res.writeHead(200);
      res.end(JSON.stringify({ agentId: newAgentId }));
      return;
    }

    // GET /api/integrity
    if (path === "/api/integrity" && method === "GET") {
      const report = await getIntegrityReport(this.ctx);
      res.writeHead(200);
      res.end(JSON.stringify(report));
      return;
    }

    // GET /api/export — full memory export for backup/recovery
    if (path === "/api/export" && method === "GET") {
      const data = await exportMemories(this.ctx);
      res.writeHead(200, {
        "Content-Disposition": `attachment; filename="db0-export-${new Date().toISOString().slice(0, 10)}.json"`,
      });
      res.end(JSON.stringify(data));
      return;
    }

    // POST /api/import — restore memories from export
    if (path === "/api/import" && method === "POST") {
      const body = await readBody(req);
      const result = await importMemories(this.ctx, body);
      res.writeHead(200);
      res.end(JSON.stringify(result));
      return;
    }

    // GET /api/consolidation/candidates
    if (path === "/api/consolidation/candidates" && method === "GET") {
      const threshold = url.searchParams.has("threshold") ? Number(url.searchParams.get("threshold")) : undefined;
      const minCluster = url.searchParams.has("minCluster") ? Number(url.searchParams.get("minCluster")) : undefined;
      const candidates = await getConsolidationCandidates(this.ctx, { threshold, minCluster });
      res.writeHead(200);
      res.end(JSON.stringify(candidates));
      return;
    }

    // GET /api/consolidation/history
    if (path === "/api/consolidation/history" && method === "GET") {
      const history = await getConsolidationHistory(this.ctx);
      res.writeHead(200);
      res.end(JSON.stringify(history));
      return;
    }

    // GET /api/memories
    if (path === "/api/memories" && method === "GET") {
      const result = await listMemories(this.ctx, {
        scope: url.searchParams.get("scope") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
        limit: url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined,
        offset: url.searchParams.has("offset") ? Number(url.searchParams.get("offset")) : undefined,
      });
      res.writeHead(200);
      res.end(JSON.stringify(result));
      return;
    }

    // POST /api/search
    if (path === "/api/search" && method === "POST") {
      const body = await readBody(req);
      const results = await searchMemories(this.ctx, body);
      res.writeHead(200);
      res.end(JSON.stringify({ memories: results }));
      return;
    }

    // Memory-specific routes: /api/memories/:id[/action]
    const memoryMatch = path.match(/^\/api\/memories\/([^/]+)(\/.*)?$/);
    if (memoryMatch) {
      const id = decodeURIComponent(memoryMatch[1]);
      const action = memoryMatch[2] ?? "";

      if (method === "GET" && action === "") {
        const memory = await getMemory(this.ctx, id);
        if (!memory) { res.writeHead(404); res.end(JSON.stringify({ error: "Not found" })); return; }
        res.writeHead(200);
        res.end(JSON.stringify(memory));
        return;
      }

      if (method === "GET" && action === "/chain") {
        const chain = await getSupersedChain(this.ctx, id);
        res.writeHead(200);
        res.end(JSON.stringify({ chain }));
        return;
      }

      if (method === "GET" && action === "/explain") {
        const query = url.searchParams.get("query") ?? undefined;
        const explained = await explainMemory(this.ctx, id, query);
        if (!explained) { res.writeHead(404); res.end(JSON.stringify({ error: "Not found" })); return; }
        res.writeHead(200);
        res.end(JSON.stringify(explained));
        return;
      }

      if (method === "PUT" && action === "") {
        const body = await readBody(req);
        const updated = await correctMemory(this.ctx, id, body);
        res.writeHead(200);
        res.end(JSON.stringify(updated));
        return;
      }

      if (method === "POST" && action === "/confirm") {
        const confirmed = await confirmMemory(this.ctx, id);
        res.writeHead(200);
        res.end(JSON.stringify(confirmed));
        return;
      }

      if (method === "DELETE" && action === "") {
        await deleteMemory(this.ctx, id);
        res.writeHead(204);
        res.end();
        return;
      }
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  }
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}
