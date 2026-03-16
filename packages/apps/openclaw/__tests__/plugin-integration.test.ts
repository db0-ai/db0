import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db0, Db0ContextEngine, createSqliteBackend } from "../src/index.js";
import type { AgentMessage, Db0Backend } from "../src/index.js";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const makeMessages = (...texts: Array<[string, string]>): AgentMessage[] =>
  texts.map(([role, content]) => ({ role, content }));

describe("Plugin Integration: Session Isolation", () => {
  let backend: Db0Backend;
  let engineA: Db0ContextEngine;
  let engineB: Db0ContextEngine;

  beforeEach(async () => {
    backend = await createSqliteBackend();
    engineA = db0({ storage: backend, embeddings: "hash" });
    engineB = db0({ storage: backend, embeddings: "hash" });
  });

  afterEach(async () => {
    try { await engineA.dispose(); } catch { /* shared backend */ }
    try { await engineB.dispose(); } catch { /* shared backend */ }
  });

  it("session-scoped facts do not bleed between engines", async () => {
    await engineA.bootstrap({
      sessionId: "session-a",
      sessionFile: `/tmp/iso-a-${Date.now()}.jsonl`,
    });
    await engineB.bootstrap({
      sessionId: "session-b",
      sessionFile: `/tmp/iso-b-${Date.now()}.jsonl`,
    });

    // Ingest a session-scoped fact into engine A
    // Use the harness directly to control scope
    const harnessA = (engineA as unknown as { harness: any }).harness;
    const embedFn = (engineA as unknown as { embeddingFn: (t: string) => Promise<Float32Array> }).embeddingFn;
    await harnessA.memory().write({
      content: "Session A secret: working on project Alpha.",
      scope: "session",
      embedding: await embedFn("Session A secret: working on project Alpha."),
      tags: ["session-scoped"],
    });

    // Engine B's assemble should NOT find session-scoped facts from engine A
    const assembledB = await engineB.assemble({
      sessionId: "session-b",
      messages: makeMessages(["user", "What project am I working on?"]),
    });

    // Session-scoped facts from A should not appear in B
    if (assembledB.systemPromptAddition) {
      expect(assembledB.systemPromptAddition).not.toContain("project Alpha");
    }
  });

  it("engines sharing a backend see user-scoped facts", async () => {
    await engineA.bootstrap({
      sessionId: "session-a",
      sessionFile: `/tmp/iso-shared-a-${Date.now()}.jsonl`,
    });
    await engineB.bootstrap({
      sessionId: "session-b",
      sessionFile: `/tmp/iso-shared-b-${Date.now()}.jsonl`,
    });

    // Ingest a user-scoped fact via engine A (via the harness for scope control)
    const harnessA = (engineA as unknown as { harness: any }).harness;
    const embedFn = (engineA as unknown as { embeddingFn: (t: string) => Promise<Float32Array> }).embeddingFn;
    await harnessA.memory().write({
      content: "The user prefers dark mode for all applications.",
      scope: "user",
      embedding: await embedFn("The user prefers dark mode for all applications."),
      tags: ["preference"],
    });

    // Engine B should find the user-scoped fact since they share the backend
    const assembledB = await engineB.assemble({
      sessionId: "session-b",
      messages: makeMessages(["user", "What does the user prefer for applications?"]),
    });

    expect(assembledB.systemPromptAddition).toBeDefined();
    expect(assembledB.systemPromptAddition).toContain("Relevant Memory");
  });
});

describe("Plugin Integration: Tool Routing with Session Context", () => {
  let engines: Map<string, Db0ContextEngine>;
  let latestEngine: Db0ContextEngine | null;
  let backend: Db0Backend;

  function resolveEngine(ctx?: { sessionId?: string }): Db0ContextEngine | null {
    if (ctx && ctx.sessionId) {
      for (const eng of engines.values()) {
        if ((eng as any)._db0SessionId === ctx.sessionId) return eng;
      }
    }
    return latestEngine;
  }

  beforeEach(async () => {
    engines = new Map();
    latestEngine = null;
    backend = await createSqliteBackend();
  });

  afterEach(async () => {
    for (const eng of engines.values()) {
      try { await eng.dispose(); } catch { /* shared backend */ }
    }
  });

  it("resolveEngine returns engine matching sessionId", async () => {
    // Simulate the cli.ts factory pattern
    const engine1 = db0({ storage: backend, embeddings: "hash" });
    (engine1 as any)._db0SessionId = "session-1";
    engines.set("1", engine1);
    latestEngine = engine1;

    const engine2 = db0({ storage: backend, embeddings: "hash" });
    (engine2 as any)._db0SessionId = "session-2";
    engines.set("2", engine2);
    latestEngine = engine2;

    // Should resolve to the correct engine by sessionId
    expect(resolveEngine({ sessionId: "session-1" })).toBe(engine1);
    expect(resolveEngine({ sessionId: "session-2" })).toBe(engine2);
  });

  it("resolveEngine falls back to latestEngine for unknown sessionId", async () => {
    const engine1 = db0({ storage: backend, embeddings: "hash" });
    (engine1 as any)._db0SessionId = "session-1";
    engines.set("1", engine1);
    latestEngine = engine1;

    // Unknown sessionId should fall back to latestEngine
    expect(resolveEngine({ sessionId: "unknown-session" })).toBe(latestEngine);
  });

  it("resolveEngine falls back to latestEngine when no context provided", async () => {
    const engine1 = db0({ storage: backend, embeddings: "hash" });
    (engine1 as any)._db0SessionId = "session-1";
    engines.set("1", engine1);
    latestEngine = engine1;

    // No context at all
    expect(resolveEngine()).toBe(latestEngine);
    expect(resolveEngine(undefined)).toBe(latestEngine);
    expect(resolveEngine({})).toBe(latestEngine);
  });
});

describe("Plugin Integration: Compaction Delegation", () => {
  it("delegates to explicit compactDelegate and includes db0Preservation", async () => {
    const delegateCalls: Record<string, unknown>[] = [];
    const engine = db0({
      storage: ":memory:",
      embeddings: "hash",
      compactDelegate: async (params) => {
        delegateCalls.push(params);
        return {
          ok: true,
          compacted: true,
          reason: "truncated by test delegate",
          result: {
            tokensBefore: 10000,
            tokensAfter: 5000,
          },
        };
      },
    });

    const sessionFile = `/tmp/compact-delegate-${Date.now()}.jsonl`;
    await engine.bootstrap({
      sessionId: "compact-test",
      sessionFile,
    });

    // Ingest some facts first
    await engine.ingest({
      sessionId: "compact-test",
      message: { role: "assistant", content: "The user prefers TypeScript for all projects." },
    });
    await engine.ingest({
      sessionId: "compact-test",
      message: { role: "assistant", content: "The project uses PostgreSQL as the database." },
    });

    // Now compact — should delegate
    const result = await engine.compact({
      sessionId: "compact-test",
      sessionFile,
      tokenBudget: 4096,
      currentTokenCount: 10000,
      runtimeContext: { workspaceDir: "/tmp" },
    });

    expect(result.ok).toBe(true);
    expect(result.compacted).toBe(true);
    expect(result.reason).toBe("truncated by test delegate");

    // Delegate was called with correct params
    expect(delegateCalls.length).toBe(1);
    expect(delegateCalls[0]).toHaveProperty("sessionId", "compact-test");

    // Result includes db0Preservation details
    expect(result.result?.details).toHaveProperty("db0Preservation");

    await engine.dispose();
    try { rmSync(`${sessionFile}.db0.journal.ndjson`, { force: true }); } catch { /* ignore */ }
  });

  it("auto-resolves legacy engine from Symbol.for('openclaw.contextEngineRegistryState')", async () => {
    const registryKey = Symbol.for("openclaw.contextEngineRegistryState");
    const legacyCompactCalls: Record<string, unknown>[] = [];
    const mockLegacyEngine = {
      info: { id: "legacy", name: "Legacy" },
      compact: async (params: Record<string, unknown>) => {
        legacyCompactCalls.push(params);
        return {
          ok: true,
          compacted: true,
          reason: "legacy auto-resolved",
          result: {
            tokensBefore: (params.currentTokenCount as number) ?? 0,
            tokensAfter: 3000,
          },
        };
      },
    };
    const mockState = {
      engines: new Map([["legacy", () => mockLegacyEngine]]),
    };
    (globalThis as Record<symbol, unknown>)[registryKey] = mockState;

    try {
      const engine = db0({ storage: ":memory:", embeddings: "hash" });
      const sessionFile = `/tmp/auto-resolve-${Date.now()}.jsonl`;
      await engine.bootstrap({
        sessionId: "auto-test",
        sessionFile,
      });

      // Ingest a fact so preservation has something to work with
      await engine.ingest({
        sessionId: "auto-test",
        message: { role: "assistant", content: "The user prefers dark mode." },
      });

      const result = await engine.compact({
        sessionId: "auto-test",
        sessionFile,
        tokenBudget: 4096,
        currentTokenCount: 7000,
        runtimeContext: { workspaceDir: "/tmp" },
      });

      expect(result.ok).toBe(true);
      expect(result.compacted).toBe(true);
      expect(result.reason).toBe("legacy auto-resolved");
      expect(result.result?.tokensAfter).toBe(3000);
      expect(result.result?.details).toHaveProperty("db0Preservation");
      expect(legacyCompactCalls.length).toBe(1);

      await engine.dispose();
      try { rmSync(`${sessionFile}.db0.journal.ndjson`, { force: true }); } catch { /* ignore */ }
    } finally {
      delete (globalThis as Record<symbol, unknown>)[registryKey];
    }
  });
});

describe("Plugin Integration: Subagent Lifecycle", () => {
  let engine: Db0ContextEngine;

  beforeEach(async () => {
    engine = db0({ storage: ":memory:", embeddings: "hash" });
    await engine.bootstrap({
      sessionId: "parent-session",
      sessionFile: `/tmp/subagent-test-${Date.now()}.jsonl`,
    });
  });

  afterEach(async () => {
    await engine.dispose();
  });

  it("full spawn -> work -> end cycle", async () => {
    // Spawn a child
    const spawnResult = await engine.prepareSubagentSpawn({
      parentSessionKey: "parent-session",
      childSessionKey: "child-1",
    });

    expect(spawnResult).toBeDefined();
    expect(typeof spawnResult!.rollback).toBe("function");

    // End the child
    await engine.onSubagentEnded({
      childSessionKey: "child-1",
      reason: "completed",
    });

    // No error = success
  });

  it("rollback does not throw", async () => {
    const spawnResult = await engine.prepareSubagentSpawn({
      parentSessionKey: "parent-session",
      childSessionKey: "child-rollback",
    });

    expect(spawnResult).toBeDefined();

    // Rollback should not throw
    await expect(spawnResult!.rollback()).resolves.not.toThrow();
  });

  it("onSubagentEnded for unknown child is a no-op", async () => {
    // Should not throw for an unknown child key
    await expect(
      engine.onSubagentEnded({
        childSessionKey: "never-spawned-child",
        reason: "deleted",
      }),
    ).resolves.not.toThrow();
  });

  it("prepareSubagentSpawn returns undefined when not bootstrapped", async () => {
    const freshEngine = db0({ storage: ":memory:", embeddings: "hash" });

    const result = await freshEngine.prepareSubagentSpawn({
      parentSessionKey: "parent",
      childSessionKey: "child",
    });

    expect(result).toBeUndefined();
    await freshEngine.dispose();
  });
});

describe("Plugin Integration: File Restore Paths", () => {
  let workspaceDir: string;
  let engine: Db0ContextEngine;
  let sessionFile: string;

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), "db0-restore-"));
    sessionFile = `/tmp/restore-test-${Date.now()}-${Math.random().toString(16).slice(2)}.jsonl`;
  });

  afterEach(async () => {
    try { await engine.dispose(); } catch { /* ignore */ }
    try { rmSync(workspaceDir, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(`${sessionFile}.db0.journal.ndjson`, { force: true }); } catch { /* ignore */ }
  });

  it("snapshot and restore: afterTurn syncs files, snapshots are created, restore works", async () => {
    // Write memory files to the workspace
    writeFileSync(join(workspaceDir, "MEMORY.md"), "# Project Memory\nThe project uses React and TypeScript.\n");
    mkdirSync(join(workspaceDir, "memory"), { recursive: true });
    writeFileSync(
      join(workspaceDir, "memory", "2026-03-10.md"),
      "Decided to switch from REST to GraphQL.\n",
    );

    engine = db0({
      storage: ":memory:",
      embeddings: "hash",
      memoryBackend: { workspaceDir },
    });

    await engine.bootstrap({
      sessionId: "restore-session",
      sessionFile,
    });

    // afterTurn triggers sync (files -> file-chunks in backend)
    await engine.afterTurn({
      sessionId: "restore-session",
      sessionFile,
      messages: makeMessages(["user", "hi"], ["assistant", "hello"]),
      prePromptMessageCount: 1,
    });

    // Verify memory backend exists
    const memBackend = engine.memoryBackend;
    expect(memBackend).toBeDefined();

    // snapshotFiles persists file snapshots to the backend unconditionally.
    // (afterTurn's sync() indexes files as chunks but doesn't persist
    // full-content snapshots; compact() or explicit snapshotFiles() are
    // needed to persist them for restore.)
    const snapResult = await memBackend!.snapshotFiles();
    expect(snapResult.length).toBeGreaterThan(0);

    const snapshots = await memBackend!.listSnapshots();
    expect(snapshots.length).toBeGreaterThan(0);

    // Check we have snapshots for our files
    const snapshotPaths = snapshots.map((s) => s.relativePath);
    expect(snapshotPaths).toContain("MEMORY.md");

    // Now delete the workspace files
    rmSync(join(workspaceDir, "MEMORY.md"));
    rmSync(join(workspaceDir, "memory"), { recursive: true, force: true });

    expect(existsSync(join(workspaceDir, "MEMORY.md"))).toBe(false);

    // Restore from snapshots
    const restoreResult = await memBackend!.restoreWorkspace();

    // Should have restored files
    expect(restoreResult.restored.length).toBeGreaterThan(0);

    // Verify MEMORY.md is restored
    const restoredMemory = restoreResult.restored.find((r) => r.relativePath === "MEMORY.md");
    expect(restoredMemory).toBeDefined();

    // The file should exist on disk again
    expect(existsSync(join(workspaceDir, "MEMORY.md"))).toBe(true);
    const content = readFileSync(join(workspaceDir, "MEMORY.md"), "utf-8");
    expect(content).toContain("React and TypeScript");
  });

  it("restoreWorkspace skips files that already exist locally", async () => {
    writeFileSync(join(workspaceDir, "MEMORY.md"), "Original content.\n");

    engine = db0({
      storage: ":memory:",
      embeddings: "hash",
      memoryBackend: { workspaceDir },
    });

    await engine.bootstrap({
      sessionId: "skip-session",
      sessionFile,
    });

    // Sync so snapshots are created
    await engine.afterTurn({
      sessionId: "skip-session",
      sessionFile,
      messages: makeMessages(["user", "hi"], ["assistant", "hello"]),
      prePromptMessageCount: 1,
    });

    const memBackend = engine.memoryBackend;
    expect(memBackend).toBeDefined();

    // File still exists locally — restore should skip it
    const restoreResult = await memBackend!.restoreWorkspace();
    expect(restoreResult.skipped.length).toBeGreaterThan(0);

    const skippedMemory = restoreResult.skipped.find((s) => s.relativePath === "MEMORY.md");
    expect(skippedMemory).toBeDefined();
    expect(skippedMemory!.reason).toContain("already exists");
  });
});
