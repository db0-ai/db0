import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db0, Db0ContextEngine, createSqliteBackend, deriveEmbeddingId } from "../src/index.js";
import type { AgentMessage } from "../src/index.js";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("db0() factory", () => {
  it("creates a Db0ContextEngine with zero config", () => {
    const engine = db0();
    expect(engine).toBeInstanceOf(Db0ContextEngine);
  });

  it("has the required info property", () => {
    const engine = db0();
    expect(engine.info).toMatchObject({
      id: "db0",
      name: "db0 Semantic Memory",
      version: "0.1.0",
      ownsCompaction: false,
      supportsSystemPromptAddition: true,
      supportsIngestBatch: true,
      supportsSubagents: true,
      supportsCompactionSafetySnapshot: true,
    });
  });
});

describe("Db0ContextEngine", () => {
  let engine: Db0ContextEngine;
  let bootstrapParams: {
    sessionId: string;
    sessionFile: string;
  };

  const makeMessages = (...texts: Array<[string, string]>): AgentMessage[] =>
    texts.map(([role, content]) => ({ role, content }));

  beforeEach(() => {
    engine = db0({ storage: ":memory:", embeddings: "hash" });
    bootstrapParams = {
      sessionId: "session-1",
      sessionFile: `/tmp/test-session-${Date.now()}-${Math.random().toString(16).slice(2)}.jsonl`,
    };
  });

  afterEach(async () => {
    await engine.dispose();
    try {
      rmSync(`${bootstrapParams.sessionFile}.db0.journal.ndjson`, { force: true });
    } catch {
      // ignore
    }
  });

  it("bootstraps and returns BootstrapResult", async () => {
    const result = await engine.bootstrap(bootstrapParams);
    expect(result).toMatchObject({ bootstrapped: true });
    expect(typeof result.importedMessages).toBe("number");
  });

  it("assemble returns messages pass-through when no memories exist", async () => {
    await engine.bootstrap(bootstrapParams);

    const messages = makeMessages(["user", "Hello"]);
    const result = await engine.assemble({
      sessionId: "session-1",
      messages,
      tokenBudget: 4096,
    });

    expect(result.messages).toBe(messages);
    expect(result.estimatedTokens).toBeGreaterThan(0);
    expect(result.systemPromptAddition).toBeUndefined();
  });

  it("assemble returns messages when not bootstrapped", async () => {
    const messages = makeMessages(["user", "Hello"]);
    const result = await engine.assemble({
      sessionId: "session-1",
      messages,
    });

    expect(result.messages).toBe(messages);
    expect(result.estimatedTokens).toBeGreaterThan(0);
  });

  it("ingest extracts facts from assistant messages", async () => {
    await engine.bootstrap(bootstrapParams);

    const result = await engine.ingest({
      sessionId: "session-1",
      message: {
        role: "assistant",
        content: "The user prefers dark mode. I'm working on the login page.",
      },
    });

    expect(result).toEqual({ ingested: true });

    // Now assemble should find relevant memories
    const assembled = await engine.assemble({
      sessionId: "session-1",
      messages: makeMessages(["user", "What does the user prefer?"]),
    });

    expect(assembled.systemPromptAddition).toBeDefined();
    expect(assembled.systemPromptAddition).toContain("Relevant Memory");
  });

  it("ingest skips user messages", async () => {
    await engine.bootstrap(bootstrapParams);

    const result = await engine.ingest({
      sessionId: "session-1",
      message: { role: "user", content: "Remember I like dark mode." },
    });

    expect(result).toEqual({ ingested: true });

    // No memory should be extracted from user messages
    const assembled = await engine.assemble({
      sessionId: "session-1",
      messages: makeMessages(["user", "dark mode"]),
    });

    expect(assembled.systemPromptAddition).toBeUndefined();
  });

  it("ingest lazily bootstraps when called before bootstrap()", async () => {
    const result = await engine.ingest({
      sessionId: "session-1",
      message: { role: "assistant", content: "test" },
    });

    expect(result).toEqual({ ingested: true });
  });

  it("full lifecycle: bootstrap → assemble → ingest → afterTurn → assemble", async () => {
    await engine.bootstrap(bootstrapParams);

    // First assemble — no memories
    const result1 = await engine.assemble({
      sessionId: "session-1",
      messages: makeMessages(["user", "What are my preferences?"]),
    });
    expect(result1.systemPromptAddition).toBeUndefined();

    // Ingest assistant message with extractable facts
    await engine.ingest({
      sessionId: "session-1",
      message: {
        role: "assistant",
        content: "The user prefers TypeScript. Remember that they always use VS Code.",
      },
    });

    // After turn
    await engine.afterTurn({
      sessionId: "session-1",
      sessionFile: "/tmp/test-session.jsonl",
      messages: makeMessages(
        ["user", "What are my preferences?"],
        ["assistant", "The user prefers TypeScript. Remember that they always use VS Code."],
      ),
      prePromptMessageCount: 1,
    });

    // Second assemble — should find memories
    const result2 = await engine.assemble({
      sessionId: "session-1",
      messages: makeMessages(["user", "What does the user prefer?"]),
    });

    expect(result2.systemPromptAddition).toBeDefined();
    expect(result2.systemPromptAddition).toContain("Relevant Memory");
  });

  it("ingestBatch processes multiple messages", async () => {
    await engine.bootstrap(bootstrapParams);

    const result = await engine.ingestBatch({
      sessionId: "session-1",
      messages: [
        { role: "user", content: "Tell me about TypeScript" },
        { role: "assistant", content: "The user prefers functional programming." },
        { role: "user", content: "Thanks" },
      ],
    });

    expect(result.ingestedCount).toBe(3);
  });

  it("compact preserves facts and returns compacted:false without delegate", async () => {
    // Without a compactDelegate or legacy engine in the registry,
    // compact does preservation only and signals no truncation happened.
    await engine.bootstrap(bootstrapParams);

    const result = await engine.compact({
      sessionId: "session-1",
      sessionFile: "/tmp/test-session.jsonl",
      tokenBudget: 4096,
    });

    expect(result.ok).toBe(true);
    expect(result.compacted).toBe(false);
    expect(result.reason).toContain("no compact delegate");
  });

  it("compact delegates to compactDelegate when provided", async () => {
    const delegateCalls: Record<string, unknown>[] = [];
    const engineWithDelegate = db0({
      storage: ":memory:",
      embeddings: "hash",
      compactDelegate: async (params) => {
        delegateCalls.push(params);
        return {
          ok: true,
          compacted: true,
          reason: "truncated by delegate",
          result: {
            tokensBefore: 8000,
            tokensAfter: 4000,
          },
        };
      },
    });

    await engineWithDelegate.bootstrap({
      sessionId: "delegate-test",
      sessionFile: `/tmp/delegate-test-${Date.now()}.jsonl`,
    });

    const result = await engineWithDelegate.compact({
      sessionId: "delegate-test",
      sessionFile: `/tmp/delegate-test.jsonl`,
      tokenBudget: 4096,
      currentTokenCount: 8000,
      runtimeContext: { workspaceDir: "/tmp" },
    });

    expect(result.ok).toBe(true);
    expect(result.compacted).toBe(true);
    expect(result.reason).toBe("truncated by delegate");
    expect(result.result?.tokensBefore).toBe(8000);
    expect(result.result?.tokensAfter).toBe(4000);
    expect(result.result?.details).toHaveProperty("db0Preservation");
    expect(delegateCalls.length).toBe(1);
    expect(delegateCalls[0]).toHaveProperty("sessionId", "delegate-test");

    await engineWithDelegate.dispose();
  });

  it("compact auto-resolves legacy engine from process-global registry", async () => {
    // Simulate OpenClaw's process-global context engine registry
    const registryKey = Symbol.for("openclaw.contextEngineRegistryState");
    const mockLegacyEngine = {
      info: { id: "legacy", name: "Legacy" },
      compact: async (params: Record<string, unknown>) => ({
        ok: true,
        compacted: true,
        reason: "legacy truncated",
        result: {
          tokensBefore: params.currentTokenCount as number ?? 0,
          tokensAfter: 2000,
        },
      }),
    };
    const mockState = {
      engines: new Map([["legacy", () => mockLegacyEngine]]),
    };
    // Install mock registry
    (globalThis as Record<symbol, unknown>)[registryKey] = mockState;

    try {
      // Engine WITHOUT explicit compactDelegate — should auto-resolve
      const autoEngine = db0({ storage: ":memory:", embeddings: "hash" });
      await autoEngine.bootstrap({
        sessionId: "auto-resolve-test",
        sessionFile: `/tmp/auto-resolve-${Date.now()}.jsonl`,
      });

      const result = await autoEngine.compact({
        sessionId: "auto-resolve-test",
        sessionFile: "/tmp/auto-resolve.jsonl",
        tokenBudget: 4096,
        currentTokenCount: 6000,
        runtimeContext: { workspaceDir: "/tmp" },
      });

      expect(result.ok).toBe(true);
      expect(result.compacted).toBe(true);
      expect(result.reason).toBe("legacy truncated");
      expect(result.result?.tokensAfter).toBe(2000);
      expect(result.result?.details).toHaveProperty("db0Preservation");

      await autoEngine.dispose();
    } finally {
      // Clean up mock registry
      delete (globalThis as Record<symbol, unknown>)[registryKey];
    }
  });

  it("works with custom embeddingFn", async () => {
    const customEngine = db0({
      storage: ":memory:",
      embeddings: async (text: string) => {
        const vec = new Float32Array(4);
        for (let i = 0; i < text.length; i++) {
          vec[i % 4] += text.charCodeAt(i);
        }
        return vec;
      },
    });

    await customEngine.bootstrap(bootstrapParams);
    await customEngine.ingest({
      sessionId: "session-1",
      message: { role: "assistant", content: "The user prefers dark mode." },
    });
    await customEngine.dispose();
  });

  it("accepts a backend instance directly", async () => {
    const { createSqliteBackend } = await import("@db0-ai/backends-sqlite");
    const backend = await createSqliteBackend();

    const customEngine = db0({ storage: backend, embeddings: "hash" });
    await customEngine.bootstrap(bootstrapParams);
    await customEngine.ingest({
      sessionId: "session-1",
      message: { role: "assistant", content: "User prefers dark mode." },
    });
    await customEngine.dispose();
  });

  it("works with extraction: 'manual'", async () => {
    const manualEngine = db0({ storage: ":memory:", extraction: "manual", embeddings: "hash" });
    await manualEngine.bootstrap(bootstrapParams);

    await manualEngine.ingest({
      sessionId: "session-1",
      message: { role: "assistant", content: "The user prefers TypeScript." },
    });

    const result = await manualEngine.assemble({
      sessionId: "session-1",
      messages: makeMessages(["user", "What does the user prefer?"]),
    });

    expect(result.systemPromptAddition).toBeUndefined();
    await manualEngine.dispose();
  });

  it("custom agentId config", async () => {
    const customEngine = db0({ storage: ":memory:", agentId: "my-agent", embeddings: "hash" });
    await customEngine.bootstrap(bootstrapParams);
    await customEngine.ingest({
      sessionId: "session-1",
      message: { role: "assistant", content: "User prefers dark mode." },
    });
    await customEngine.dispose();
  });

  it("isolates user-scoped memory by userId on shared backend", async () => {
    const { createSqliteBackend } = await import("@db0-ai/backends-sqlite");
    const backend = await createSqliteBackend();

    const engineA = db0({
      storage: backend,
      agentId: "shared-agent",
      userId: "user-a",
      embeddings: "hash",
    });
    const engineB = db0({
      storage: backend,
      agentId: "shared-agent",
      userId: "user-b",
      embeddings: "hash",
    });

    await engineA.bootstrap({
      sessionId: "session-a",
      sessionFile: `/tmp/test-session-a-${Date.now()}.jsonl`,
    });
    await engineB.bootstrap({
      sessionId: "session-b",
      sessionFile: `/tmp/test-session-b-${Date.now()}.jsonl`,
    });

    const harnessA = (engineA as unknown as { harness: any }).harness;
    const embedA = (engineA as unknown as { embeddingFn: (t: string) => Promise<Float32Array> }).embeddingFn;
    await harnessA.memory().write({
      content: "The user prefers dark mode.",
      scope: "user",
      embedding: await embedA("The user prefers dark mode."),
      tags: ["preference"],
    });

    const assembledB = await engineB.assemble({
      sessionId: "session-b",
      messages: makeMessages(["user", "What does the user prefer?"]),
    });

    expect(assembledB.systemPromptAddition).toBeUndefined();

    await engineA.dispose();
    try {
      await engineB.dispose();
    } catch {
      // Shared backend may already be closed by engineA.
    }
  });

  it("dedups repeated extracted facts", async () => {
    await engine.bootstrap(bootstrapParams);

    await engine.ingest({
      sessionId: "session-1",
      message: { role: "assistant", content: "The user prefers dark mode." },
    });
    await engine.ingest({
      sessionId: "session-1",
      message: { role: "assistant", content: "The user prefers dark mode." },
    });

    const harness = (engine as unknown as { harness: any }).harness;
    const found = await harness.memory().search({
      embedding: await (engine as unknown as { embeddingFn: (t: string) => Promise<Float32Array> }).embeddingFn("dark mode"),
      scope: ["user", "agent", "session"],
      limit: 10,
      minScore: 0.4,
    });
    const exact = found.filter((m: any) => String(m.content).toLowerCase().includes("prefers dark mode"));
    expect(exact.length).toBe(1);
  });

  it("links contradiction candidates with an edge", async () => {
    await engine.bootstrap(bootstrapParams);

    const harness = (engine as unknown as { harness: any }).harness;
    const ctx = harness.context();

    const first = await ctx.ingest(
      "The user prefers dark mode for all apps.",
      { scope: "user", tags: ["preference"] },
    );
    expect(first.contradictionLinked).toBe(false);

    const second = await ctx.ingest(
      "The user does not prefer dark mode for all apps.",
      { scope: "user", tags: ["preference"] },
    );
    expect(second.contradictionLinked).toBe(true);
  });

  it("recover replays journaled messages", async () => {
    await engine.bootstrap(bootstrapParams);
    await engine.ingest({
      sessionId: "session-1",
      message: { role: "assistant", content: "The user prefers terminal-based workflows." },
    });
    await engine.flush("test");
    const recovered = await engine.recover("test");
    expect(recovered.ok).toBe(true);
    expect(recovered.importedMessages).toBeGreaterThanOrEqual(1);
  });

  // === Multi-tier extraction pipeline ===

  describe("tier 1: file promotion", () => {
    let workspaceDir: string;

    beforeEach(() => {
      workspaceDir = mkdtempSync(join(tmpdir(), "db0-tier1-"));
    });

    afterEach(() => {
      try { rmSync(workspaceDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it("afterTurn promotes new file content to structured facts", async () => {
      // Write a memory file with extractable content
      writeFileSync(join(workspaceDir, "MEMORY.md"), "The user prefers dark mode for all editors.\n");

      const t1engine = db0({
        storage: ":memory:",
        embeddings: "hash",
        memoryBackend: { workspaceDir },
      });
      const t1params = {
        sessionId: "tier1-session",
        sessionFile: `/tmp/tier1-test-${Date.now()}.jsonl`,
      };
      await t1engine.bootstrap(t1params);

      // afterTurn triggers sync + tier-1 promotion
      await t1engine.afterTurn({
        sessionId: "tier1-session",
        sessionFile: t1params.sessionFile,
        messages: makeMessages(["user", "hi"], ["assistant", "hello"]),
        prePromptMessageCount: 1,
      });

      // Now write new content to a daily memory file
      mkdirSync(join(workspaceDir, "memory"), { recursive: true });
      writeFileSync(
        join(workspaceDir, "memory", "2026-03-11.md"),
        "The user decided to use WebSocket instead of SSE.\n",
      );

      // Second afterTurn — should detect the new file and promote
      await t1engine.afterTurn({
        sessionId: "tier1-session",
        sessionFile: t1params.sessionFile,
        messages: makeMessages(["user", "update"], ["assistant", "done"]),
        prePromptMessageCount: 1,
      });

      // Search for the promoted fact
      const harness = (t1engine as unknown as { harness: any }).harness;
      const embed = (t1engine as unknown as { embeddingFn: (t: string) => Promise<Float32Array> }).embeddingFn;
      const found = await harness.memory().search({
        embedding: await embed("decided to use WebSocket"),
        scope: ["session", "user", "agent"],
        limit: 10,
        minScore: 0.3,
      });

      const promoted = found.filter((m: any) =>
        m.tags.includes("tier-1") && m.tags.includes("file-promoted"),
      );
      expect(promoted.length).toBeGreaterThan(0);

      await t1engine.dispose();
      try { rmSync(`${t1params.sessionFile}.db0.journal.ndjson`, { force: true }); } catch { /* ignore */ }
    });

    it("tier 1 deduplicates against existing facts", async () => {
      // Start with empty workspace
      writeFileSync(join(workspaceDir, "MEMORY.md"), "# Memory\n");

      const t1engine = db0({
        storage: ":memory:",
        embeddings: "hash",
        memoryBackend: { workspaceDir },
      });
      const t1params = {
        sessionId: "dedup-session",
        sessionFile: `/tmp/tier1-dedup-${Date.now()}.jsonl`,
      };
      await t1engine.bootstrap(t1params);

      // First: ingest the fact via tier 0
      await t1engine.ingest({
        sessionId: "dedup-session",
        message: { role: "assistant", content: "The user prefers TypeScript for projects." },
      });

      // Now simulate OpenClaw writing the same fact to MEMORY.md (flush)
      writeFileSync(join(workspaceDir, "MEMORY.md"), "# Memory\nThe user prefers TypeScript for projects.\n");

      // afterTurn triggers sync (detects changed MEMORY.md) + tier-1 promotion
      // Tier 1 should dedup against the existing tier-0 fact
      await t1engine.afterTurn({
        sessionId: "dedup-session",
        sessionFile: t1params.sessionFile,
        messages: makeMessages(["user", "hi"], ["assistant", "The user prefers TypeScript for projects."]),
        prePromptMessageCount: 1,
      });

      // Should still be only one structured fact (not counting file-chunks)
      const harness = (t1engine as unknown as { harness: any }).harness;
      const embed = (t1engine as unknown as { embeddingFn: (t: string) => Promise<Float32Array> }).embeddingFn;
      const found = await harness.memory().search({
        embedding: await embed("prefers TypeScript"),
        scope: ["user", "session", "agent"],
        limit: 10,
        minScore: 0.4,
      });
      const exact = found.filter((m: any) =>
        !m.tags.includes("file-chunk") &&
        !m.tags.includes("file-snapshot") &&
        String(m.content).toLowerCase().includes("prefers typescript"),
      );
      expect(exact.length).toBe(1);

      await t1engine.dispose();
      try { rmSync(`${t1params.sessionFile}.db0.journal.ndjson`, { force: true }); } catch { /* ignore */ }
    });
  });

  describe("tier 2: batch extraction", () => {
    it("triggers batch extraction after configured turn interval", async () => {
      const batchCalls: string[][] = [];
      const t2engine = db0({
        storage: ":memory:",
        embeddings: "hash",
        batchExtraction: {
          turnInterval: 3,
          batchExtractFn: async (texts) => {
            batchCalls.push(texts);
            return [
              { content: "User likes functional programming.", scope: "user" as const, tags: ["preference"] },
            ];
          },
        },
      });
      const t2params = {
        sessionId: "tier2-session",
        sessionFile: `/tmp/tier2-test-${Date.now()}.jsonl`,
      };
      await t2engine.bootstrap(t2params);

      // Ingest 3 assistant messages (hits turnInterval of 3)
      for (let i = 0; i < 3; i++) {
        await t2engine.ingest({
          sessionId: "tier2-session",
          message: { role: "assistant", content: `Turn ${i}: The user prefers functional patterns.` },
        });
      }

      // afterTurn should trigger batch extraction
      await t2engine.afterTurn({
        sessionId: "tier2-session",
        sessionFile: t2params.sessionFile,
        messages: makeMessages(["user", "hi"], ["assistant", "done"]),
        prePromptMessageCount: 1,
      });

      expect(batchCalls.length).toBe(1);
      expect(batchCalls[0].length).toBe(3);

      // The batch-extracted fact should be searchable
      const harness = (t2engine as unknown as { harness: any }).harness;
      const embed = (t2engine as unknown as { embeddingFn: (t: string) => Promise<Float32Array> }).embeddingFn;
      const found = await harness.memory().search({
        embedding: await embed("functional programming"),
        scope: ["user"],
        limit: 10,
        minScore: 0.3,
      });
      const batchFacts = found.filter((m: any) => m.tags.includes("tier-2"));
      expect(batchFacts.length).toBeGreaterThan(0);

      await t2engine.dispose();
      try { rmSync(`${t2params.sessionFile}.db0.journal.ndjson`, { force: true }); } catch { /* ignore */ }
    });

    it("flushes batch buffer before compaction", async () => {
      const batchCalls: string[][] = [];
      const t2engine = db0({
        storage: ":memory:",
        embeddings: "hash",
        batchExtraction: {
          turnInterval: 100, // won't trigger on turns
          batchExtractFn: async (texts) => {
            batchCalls.push(texts);
            return [];
          },
        },
      });
      const t2params = {
        sessionId: "tier2-compact",
        sessionFile: `/tmp/tier2-compact-${Date.now()}.jsonl`,
      };
      await t2engine.bootstrap(t2params);

      await t2engine.ingest({
        sessionId: "tier2-compact",
        message: { role: "assistant", content: "Something important before compaction." },
      });

      // compact() should flush the buffer even though turnInterval hasn't been reached
      await t2engine.compact({
        sessionId: "tier2-compact",
        sessionFile: t2params.sessionFile,
      });

      expect(batchCalls.length).toBe(1);

      await t2engine.dispose();
      try { rmSync(`${t2params.sessionFile}.db0.journal.ndjson`, { force: true }); } catch { /* ignore */ }
    });

    it("tier 2 is disabled when batchExtractFn is not provided", async () => {
      await engine.bootstrap(bootstrapParams);

      for (let i = 0; i < 20; i++) {
        await engine.ingest({
          sessionId: "session-1",
          message: { role: "assistant", content: `Turn ${i} content.` },
        });
      }

      // Should not throw
      await engine.afterTurn({
        sessionId: "session-1",
        sessionFile: bootstrapParams.sessionFile,
        messages: makeMessages(["user", "hi"], ["assistant", "done"]),
        prePromptMessageCount: 1,
      });
    });
  });

  describe("tier 3: reconciliation", () => {
    it("reconcile() returns stats even with no work", async () => {
      await engine.bootstrap(bootstrapParams);
      const result = await engine.reconcile("session-1");
      expect(result).toEqual({ promoted: 0, merged: 0, contradictionsCleaned: 0, consolidated: 0, consolidatedMemories: 0 });
    });

    it("reconcile() merges duplicate facts across tiers", async () => {
      await engine.bootstrap(bootstrapParams);

      // Write the same fact twice with different tier tags
      const harness = (engine as unknown as { harness: any }).harness;
      const embed = (engine as unknown as { embeddingFn: (t: string) => Promise<Float32Array> }).embeddingFn;
      const embedding = await embed("The user prefers dark mode.");

      await harness.memory().write({
        content: "The user prefers dark mode.",
        scope: "user",
        embedding,
        tags: ["preference", "tier-0"],
      });
      await harness.memory().write({
        content: "The user prefers dark mode.",
        scope: "user",
        embedding,
        tags: ["preference", "tier-1", "file-promoted"],
      });

      const result = await engine.reconcile("session-1");
      expect(result.merged).toBeGreaterThanOrEqual(1);
    });

    it("reconcile() cleans contradiction edges for superseded facts", async () => {
      await engine.bootstrap(bootstrapParams);

      const harness = (engine as unknown as { harness: any }).harness;
      const embed = (engine as unknown as { embeddingFn: (t: string) => Promise<Float32Array> }).embeddingFn;

      // Create two facts with a contradiction edge
      const factA = await harness.memory().write({
        content: "The project uses React.",
        scope: "user",
        embedding: await embed("The project uses React."),
        tags: ["tech", "tier-0"],
      });
      const factB = await harness.memory().write({
        content: "The project does not use React.",
        scope: "user",
        embedding: await embed("The project does not use React."),
        tags: ["tech", "tier-0", "contradiction-candidate"],
      });
      await harness.memory().addEdge({
        sourceId: factB.id,
        targetId: factA.id,
        edgeType: "contradicts",
      });

      // Supersede factA
      await harness.memory().write({
        content: "The project migrated to Svelte.",
        scope: "user",
        embedding: await embed("The project migrated to Svelte."),
        tags: ["tech"],
        supersedes: factA.id,
      });

      const result = await engine.reconcile("session-1");
      expect(result.contradictionsCleaned).toBeGreaterThanOrEqual(1);
    });
  });

  // === Sub-agent lifecycle ===

  describe("sub-agent support", () => {
    it("prepareSubagentSpawn creates a child harness", async () => {
      await engine.bootstrap(bootstrapParams);

      const result = await engine.prepareSubagentSpawn({
        parentSessionKey: "session-1",
        childSessionKey: "child-session-1",
      });

      expect(result).toBeDefined();
      expect(typeof result!.rollback).toBe("function");
    });

    it("rollback cleans up child harness", async () => {
      await engine.bootstrap(bootstrapParams);

      const result = await engine.prepareSubagentSpawn({
        parentSessionKey: "session-1",
        childSessionKey: "child-session-1",
      });

      // Should not throw
      await result!.rollback();
    });

    it("onSubagentEnded cleans up child", async () => {
      await engine.bootstrap(bootstrapParams);

      await engine.prepareSubagentSpawn({
        parentSessionKey: "session-1",
        childSessionKey: "child-session-1",
      });

      // Should not throw
      await engine.onSubagentEnded({
        childSessionKey: "child-session-1",
        reason: "completed",
      });
    });

    it("onSubagentEnded handles unknown child gracefully", async () => {
      await engine.bootstrap(bootstrapParams);

      // Should not throw even if child was never spawned
      await engine.onSubagentEnded({
        childSessionKey: "unknown-child",
        reason: "deleted",
      });
    });

    it("sub-agent methods are no-ops when not bootstrapped", async () => {
      const result = await engine.prepareSubagentSpawn({
        parentSessionKey: "session-1",
        childSessionKey: "child-session-1",
      });
      expect(result).toBeUndefined();

      // Should not throw
      await engine.onSubagentEnded({
        childSessionKey: "child-session-1",
        reason: "completed",
      });
    });
  });

  describe("embedding migration", () => {
    it("stores embedding_id on first bootstrap", async () => {
      const backend = await createSqliteBackend();
      const engine = db0({
        storage: backend,
        embeddings: "hash",
      });

      await engine.bootstrap({
        sessionId: "session-1",
        sessionFile: "/tmp/test-session.jsonl",
      });

      const storedId = await backend.metaGet("embedding_id");
      expect(storedId).toBe("hash:hash-128");
      await engine.dispose();
    });

    it("re-embeds memories when provider changes", async () => {
      const backend = await createSqliteBackend();

      // Phase 1: bootstrap with "hash" and ingest a fact
      const engine1 = db0({
        storage: backend,
        embeddings: "hash",
      });
      await engine1.bootstrap({
        sessionId: "session-1",
        sessionFile: "/tmp/test-session.jsonl",
      });
      await engine1.ingest({
        sessionId: "session-1",
        message: { role: "assistant", content: "I remember that the user likes coffee" },
      });

      // Verify we have active memories
      const before = await backend.memoryList("main");
      const activeBefore = before.filter((m) => m.status === "active");
      expect(activeBefore.length).toBeGreaterThan(0);

      // Phase 2: bootstrap with a custom embedding fn — triggers migration
      // Note: don't dispose engine1 — it would close the shared in-memory backend
      let reEmbedCalled = 0;
      const customEmbedFn = async (_text: string) => {
        reEmbedCalled++;
        return new Float32Array(128).fill(0.42);
      };

      const engine2 = db0({
        storage: backend,
        embeddings: customEmbedFn,
      });
      await engine2.bootstrap({
        sessionId: "session-2",
        sessionFile: "/tmp/test-session2.jsonl",
      });

      // Wait for background migration to complete
      await engine2.migrationReady;

      // Should have called the new embedding fn for each active memory
      expect(reEmbedCalled).toBeGreaterThan(0);

      // Stored ID should be updated
      const storedId = await backend.metaGet("embedding_id");
      expect(storedId).toBe("custom");

      // Old memories should be superseded, new ones active
      const after = await backend.memoryList("main");
      const activeAfter = after.filter((m) => m.status === "active");
      const supersededAfter = after.filter((m) => m.status === "superseded");
      expect(supersededAfter.length).toBeGreaterThan(0);
      expect(activeAfter.length).toBeGreaterThan(0);

      // Active memories should have the new embedding
      for (const mem of activeAfter) {
        if (mem.embedding.length === 128) {
          expect(mem.embedding[0]).toBeCloseTo(0.42);
        }
      }

      backend.close();
    });

    it("skips migration when embeddings config unchanged", async () => {
      const backend = await createSqliteBackend();

      // First bootstrap sets embedding_id
      const engine1 = db0({ storage: backend, embeddings: "hash" });
      await engine1.bootstrap({
        sessionId: "session-1",
        sessionFile: "/tmp/test-session.jsonl",
      });
      await engine1.ingest({
        sessionId: "session-1",
        message: { role: "assistant", content: "I remember that the user prefers tea" },
      });

      const before = await backend.memoryList("main");

      // Second bootstrap with same config — no migration
      const engine2 = db0({ storage: backend, embeddings: "hash" });
      await engine2.bootstrap({
        sessionId: "session-2",
        sessionFile: "/tmp/test-session2.jsonl",
      });

      const after = await backend.memoryList("main");
      // No new superseded memories created
      expect(after.filter((m) => m.status === "superseded").length).toBe(
        before.filter((m) => m.status === "superseded").length,
      );

      backend.close();
    });
  });

  describe("deriveEmbeddingId", () => {
    it("returns 'hash' for no config", () => {
      expect(deriveEmbeddingId()).toBe("hash");
    });

    it("derives from string provider name", () => {
      expect(deriveEmbeddingId("gemini")).toBe("gemini:gemini-embedding-2-preview");
    });

    it("derives from full config with dimensions", () => {
      expect(
        deriveEmbeddingId({ provider: "openai", model: "text-embedding-3-large", dimensions: 256 }),
      ).toBe("openai:text-embedding-3-large:256");
    });

    it("uses default model when omitted", () => {
      expect(deriveEmbeddingId({ provider: "ollama" })).toBe("ollama:nomic-embed-text");
    });
  });
});
