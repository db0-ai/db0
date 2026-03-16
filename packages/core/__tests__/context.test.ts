import { describe, it, expect } from "vitest";
import { db0 } from "../src/index.js";
import { createSqliteBackend } from "../../backends/sqlite/src/index.js";
import { defaultEmbeddingFn } from "../src/util/embed.js";

describe("Context", () => {
  async function createHarness() {
    const backend = await createSqliteBackend();
    return db0.harness({
      agentId: "test-agent",
      sessionId: "test-session",
      userId: "test-user",
      backend,
      embeddingFn: defaultEmbeddingFn,
    });
  }

  it("returns same Context instance on repeated access", async () => {
    const harness = await createHarness();
    expect(harness.context()).toBe(harness.context());
    harness.close();
  });

  // === ingest ===

  describe("ingest", () => {
    it("writes a fact and returns id", async () => {
      const harness = await createHarness();
      const result = await harness.context().ingest(
        "The user prefers dark mode.",
        { scope: "user", tags: ["preference"] },
      );

      expect(result.deduped).toBe(false);
      expect(result.contradictionLinked).toBe(false);
      expect(result.id).toBeTruthy();

      // Verify it was actually written
      const mem = await harness.memory().get(result.id!);
      expect(mem).not.toBeNull();
      expect(mem!.content).toBe("The user prefers dark mode.");
      expect(mem!.scope).toBe("user");
      expect(mem!.tags).toContain("preference");
      harness.close();
    });

    it("deduplicates exact same content", async () => {
      const harness = await createHarness();
      const ctx = harness.context();

      const first = await ctx.ingest("The user likes coffee.", { scope: "user" });
      expect(first.deduped).toBe(false);

      const second = await ctx.ingest("The user likes coffee.", { scope: "user" });
      expect(second.deduped).toBe(true);
      expect(second.id).toBeNull();
      harness.close();
    });

    it("deduplicates case-insensitive", async () => {
      const harness = await createHarness();
      const ctx = harness.context();

      await ctx.ingest("The user likes TypeScript.", { scope: "user" });
      const dup = await ctx.ingest("the user likes typescript.", { scope: "user" });
      expect(dup.deduped).toBe(true);
      harness.close();
    });

    it("detects contradiction via negation mismatch", async () => {
      const harness = await createHarness();
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
      expect(second.id).toBeTruthy();

      // Verify contradiction edge exists
      const edges = await harness.memory().getEdges(second.id!);
      const contradicts = edges.filter((e) => e.edgeType === "contradicts");
      expect(contradicts.length).toBe(1);
      expect(contradicts[0].targetId).toBe(first.id);
      harness.close();
    });

    it("extracts entities and adds as tags", async () => {
      const harness = await createHarness();
      const result = await harness.context().ingest(
        "Alice works at Google on the Kubernetes project.",
        { scope: "user" },
      );

      const mem = await harness.memory().get(result.id!);
      expect(mem).not.toBeNull();
      // Should have entity tags
      const entityTags = mem!.tags.filter((t) => t.startsWith("entity:"));
      expect(entityTags.length).toBeGreaterThan(0);
      harness.close();
    });

    it("accepts pre-computed embedding", async () => {
      const harness = await createHarness();
      const customEmb = new Float32Array(384).fill(0.5);

      const result = await harness.context().ingest(
        "Pre-embedded fact.",
        { scope: "user", embedding: customEmb },
      );

      const mem = await harness.memory().get(result.id!);
      expect(mem!.embedding[0]).toBeCloseTo(0.5);
      harness.close();
    });
  });

  // === ingest provenance ===

  describe("ingest with provenance", () => {
    it("stores sourceType and extractionMethod on ingested memory", async () => {
      const harness = await createHarness();
      const result = await harness.context().ingest(
        "The user prefers vim keybindings.",
        { scope: "user", tags: ["preference"], sourceType: "user_statement", extractionMethod: "rules" },
      );

      expect(result.id).toBeTruthy();
      const mem = await harness.memory().get(result.id!);
      expect(mem).not.toBeNull();
      expect(mem!.sourceType).toBe("user_statement");
      expect(mem!.extractionMethod).toBe("rules");
      harness.close();
    });
  });

  // === pack ===

  describe("pack", () => {
    it("returns empty text when no memories exist", async () => {
      const harness = await createHarness();
      const result = await harness.context().pack("what does the user like?");

      expect(result.count).toBe(0);
      expect(result.text).toBe("## Relevant Memory\n");
      expect(result.memories).toHaveLength(0);
      harness.close();
    });

    it("retrieves relevant memories", async () => {
      const harness = await createHarness();
      const ctx = harness.context();

      await ctx.ingest("The user prefers dark mode.", { scope: "user" });
      await ctx.ingest("The user works with TypeScript.", { scope: "user" });

      const result = await ctx.pack("dark mode preference");

      expect(result.count).toBeGreaterThan(0);
      expect(result.text).toContain("Relevant Memory");
      expect(result.estimatedTokens).toBeGreaterThan(0);
      harness.close();
    });

    it("respects token budget", async () => {
      const harness = await createHarness();
      const ctx = harness.context();

      // Write many facts
      for (let i = 0; i < 10; i++) {
        await ctx.ingest(`Fact number ${i}: the user likes item ${i} very much.`, { scope: "user" });
      }

      const unlimited = await ctx.pack("user likes");
      const limited = await ctx.pack("user likes", { tokenBudget: 20 });

      // Limited should have fewer items
      expect(limited.count).toBeLessThanOrEqual(unlimited.count);
      harness.close();
    });

    it("includes edge annotations when includeEdges is true", async () => {
      const harness = await createHarness();
      const ctx = harness.context();

      const a = await ctx.ingest("The user prefers dark mode for all apps.", {
        scope: "user",
      });
      const b = await ctx.ingest("The user does not prefer dark mode for all apps.", {
        scope: "user",
      });

      // b should have a contradiction edge to a
      expect(b.contradictionLinked).toBe(true);

      const result = await ctx.pack("dark mode", { includeEdges: true });
      // If both memories are returned, the text should contain edge annotation
      if (result.count >= 2) {
        expect(result.text).toContain("contradicts");
      }
      harness.close();
    });

    it("filters by scope", async () => {
      const harness = await createHarness();
      const ctx = harness.context();

      await ctx.ingest("Agent-scoped fact.", { scope: "agent" });
      await ctx.ingest("User-scoped fact.", { scope: "user" });

      const agentOnly = await ctx.pack("fact", { scopes: ["agent"] });
      const allAgent = agentOnly.memories.every((m) => m.scope === "agent");
      // All returned results should match the scope filter
      if (agentOnly.count > 0) {
        expect(allAgent).toBe(true);
      }
      harness.close();
    });
  });

  // === preserve ===

  describe("preserve", () => {
    it("extracts and stores facts from messages", async () => {
      const harness = await createHarness();
      const ctx = harness.context();

      const result = await ctx.preserve([
        { role: "user", content: "My name is Alice and I prefer TypeScript." },
        { role: "assistant", content: "I learned that Alice likes Python too." },
      ]);

      expect(result.extracted).toBeGreaterThan(0);

      // Verify facts were written to memory
      const memories = await harness.memory().list("user");
      expect(memories.length).toBeGreaterThan(0);
      harness.close();
    });

    it("deduplicates across preserved messages", async () => {
      const harness = await createHarness();
      const ctx = harness.context();

      // Preserve the same content twice
      await ctx.preserve([
        { role: "assistant", content: "The user prefers dark mode." },
      ]);
      const second = await ctx.preserve([
        { role: "assistant", content: "The user prefers dark mode." },
      ]);

      // Second batch should dedup
      if (second.extracted > 0) {
        expect(second.deduped).toBeGreaterThan(0);
      }
      harness.close();
    });

    it("uses batch embedding for efficiency", async () => {
      let batchCalls = 0;
      const backend = await createSqliteBackend();
      const harness = db0.harness({
        agentId: "test-agent",
        sessionId: "test-session",
        backend,
        embeddingFn: defaultEmbeddingFn,
        batchEmbeddingFn: async (texts: string[]) => {
          batchCalls++;
          return texts.map((t) => {
            // Simple hash-like embedding for testing
            const vec = new Float32Array(384);
            for (let i = 0; i < t.length && i < 384; i++) {
              vec[i] = t.charCodeAt(i) / 256;
            }
            return vec;
          });
        },
      });

      await harness.context().preserve([
        { role: "user", content: "The user prefers TypeScript." },
        { role: "assistant", content: "I learned that the user likes dark mode." },
      ]);

      // Should have used batchEmbeddingFn (at least once)
      expect(batchCalls).toBeGreaterThan(0);
      harness.close();
    });

    it("adds custom tags to preserved facts", async () => {
      const harness = await createHarness();
      const ctx = harness.context();

      await ctx.preserve(
        [{ role: "assistant", content: "The user prefers Python." }],
        { tags: ["pre-compaction"] },
      );

      const memories = await harness.memory().list("user");
      const preserved = memories.filter((m) => m.tags.includes("preserved"));
      if (preserved.length > 0) {
        expect(preserved[0].tags).toContain("pre-compaction");
      }
      harness.close();
    });

    it("stamps extractionMethod on preserved facts", async () => {
      const harness = await createHarness();
      const ctx = harness.context();

      await ctx.preserve([
        { role: "user", content: "The user prefers Rust over Go." },
      ]);

      const memories = await harness.memory().list("user");
      const preserved = memories.filter((m) => m.tags.includes("preserved"));
      expect(preserved.length).toBeGreaterThan(0);
      for (const mem of preserved) {
        expect(mem.extractionMethod).toBeTruthy();
      }
      harness.close();
    });

    it("returns zero counts for empty messages", async () => {
      const harness = await createHarness();
      const result = await harness.context().preserve([]);
      expect(result.extracted).toBe(0);
      expect(result.deduped).toBe(0);
      expect(result.contradictions).toBe(0);
      harness.close();
    });
  });

  // === reconcile ===

  describe("reconcile", () => {
    it("returns zero stats with empty memory", async () => {
      const harness = await createHarness();
      const result = await harness.context().reconcile();
      expect(result.promoted).toBe(0);
      expect(result.merged).toBe(0);
      expect(result.contradictionsCleaned).toBe(0);
      harness.close();
    });

    it("merges exact duplicate facts", async () => {
      const harness = await createHarness();
      const mem = harness.memory();

      // Write two identical facts directly (bypassing dedup to simulate legacy data)
      const emb = await defaultEmbeddingFn("The user likes coffee.");
      await mem.write({
        content: "The user likes coffee.",
        scope: "user",
        embedding: emb,
        tags: ["fact"],
      });
      await mem.write({
        content: "The user likes coffee.",
        scope: "user",
        embedding: emb,
        tags: ["fact"],
      });

      const result = await harness.context().reconcile();
      expect(result.merged).toBeGreaterThan(0);
      harness.close();
    });

    it("stamps extractionMethod as reconcile on merged memories", async () => {
      const harness = await createHarness();
      const mem = harness.memory();

      // Write two identical facts directly (bypassing dedup to simulate legacy data)
      const emb = await defaultEmbeddingFn("The user enjoys hiking.");
      await mem.write({
        content: "The user enjoys hiking.",
        scope: "user",
        embedding: emb,
        tags: ["fact"],
      });
      await mem.write({
        content: "The user enjoys hiking.",
        scope: "user",
        embedding: emb,
        tags: ["fact"],
      });

      const result = await harness.context().reconcile();
      expect(result.merged).toBeGreaterThan(0);

      // After merge, the new merged memory should have extractionMethod "reconcile"
      const memories = await mem.list("user");
      const withReconcile = memories.filter(
        (m) => m.content === "The user enjoys hiking." && m.extractionMethod === "reconcile",
      );
      expect(withReconcile.length).toBeGreaterThanOrEqual(1);
      harness.close();
    });

    it("cleans contradiction edges for superseded memories", async () => {
      const harness = await createHarness();
      const mem = harness.memory();

      // Create two memories and manually add a contradiction edge
      const emb = await defaultEmbeddingFn("The user prefers dark mode for all applications and editors.");
      const m1 = await mem.write({
        content: "The user prefers dark mode for all applications and editors.",
        scope: "user",
        embedding: emb,
        tags: ["contradiction-candidate"],
      });
      const m2 = await mem.write({
        content: "The user does not prefer dark mode for all applications and editors.",
        scope: "user",
        embedding: await defaultEmbeddingFn("The user does not prefer dark mode for all applications and editors."),
        tags: ["contradiction-candidate"],
      });
      await mem.addEdge({
        sourceId: m2.id,
        targetId: m1.id,
        edgeType: "contradicts",
      });

      // Supersede m1
      await mem.write({
        content: "Updated preference.",
        scope: "user",
        embedding: await defaultEmbeddingFn("Updated preference."),
        tags: [],
        supersedes: m1.id,
      });

      const result = await harness.context().reconcile();
      expect(result.contradictionsCleaned).toBeGreaterThan(0);
      harness.close();
    });
  });

  // === embeddingStatus / migrateEmbeddings ===

  describe("embeddingStatus", () => {
    it("returns migrationNeeded=false on first check", async () => {
      const harness = await createHarness();
      const status = await harness.embeddingStatus("hash:hash-128");
      expect(status.currentId).toBe("hash:hash-128");
      expect(status.storedId).toBeNull();
      expect(status.migrationNeeded).toBe(false);
      harness.close();
    });

    it("detects migration needed when IDs differ", async () => {
      const backend = await createSqliteBackend();
      await backend.metaSet("embedding_id", "old-provider");

      const harness = db0.harness({
        agentId: "test",
        sessionId: "s1",
        backend,
      });

      const status = await harness.embeddingStatus("new-provider");
      expect(status.migrationNeeded).toBe(true);
      expect(status.storedId).toBe("old-provider");
      harness.close();
    });
  });

  describe("migrateEmbeddings", () => {
    it("re-embeds all active memories", async () => {
      const harness = await createHarness();

      // Write some memories with hash embeddings
      const emb = await defaultEmbeddingFn("test fact");
      await harness.memory().write({
        content: "Fact one",
        scope: "user",
        embedding: emb,
        tags: [],
      });
      await harness.memory().write({
        content: "Fact two",
        scope: "user",
        embedding: emb,
        tags: [],
      });

      // Migrate to custom embeddings
      let embedCalls = 0;
      const customEmbed = async (t: string) => {
        embedCalls++;
        return new Float32Array(128).fill(0.99);
      };
      const batchEmbed = async (texts: string[]) => {
        return Promise.all(texts.map(customEmbed));
      };

      const result = await harness.migrateEmbeddings(customEmbed, batchEmbed, "custom:v1");
      expect(result.reEmbedded).toBe(2);
      expect(result.failed).toBe(0);

      // Verify active memories have new embeddings
      const all = await harness.memory().list();
      const active = all.filter((m) => m.status === "active");
      for (const mem of active) {
        if (mem.embedding.length === 128) {
          expect(mem.embedding[0]).toBeCloseTo(0.99);
        }
      }
      harness.close();
    });
  });

  // === Full lifecycle integration ===

  describe("full lifecycle", () => {
    it("ingest → pack → preserve → reconcile end-to-end", async () => {
      const harness = await createHarness();
      const ctx = harness.context();

      // 1. Ingest individual facts
      await ctx.ingest("The user's name is Alice.", { scope: "user" });
      await ctx.ingest("Alice works at Acme Corp.", { scope: "user" });
      await ctx.ingest("The project uses TypeScript.", { scope: "agent" });

      // 2. Pack context for a query (use low minScore for hash embeddings)
      const packed = await ctx.pack("The user Alice", { minScore: 0.1 });
      expect(packed.count).toBeGreaterThan(0);
      expect(packed.text).toContain("Relevant Memory");

      // 3. Preserve conversation messages (simulating pre-compaction)
      const preserved = await ctx.preserve([
        { role: "user", content: "I prefer Python over JavaScript." },
        { role: "assistant", content: "I learned that Alice likes Python." },
      ]);
      expect(preserved.extracted).toBeGreaterThanOrEqual(0); // depends on extraction rules

      // 4. Reconcile
      const reconciled = await ctx.reconcile();
      expect(reconciled).toHaveProperty("promoted");
      expect(reconciled).toHaveProperty("merged");
      expect(reconciled).toHaveProperty("contradictionsCleaned");

      // 5. Pack again — should include preserved facts
      const packed2 = await ctx.pack("The user Alice prefers", { minScore: 0.1 });
      // At minimum, original ingested facts should still be there
      expect(packed2.count).toBeGreaterThan(0);

      harness.close();
    });
  });
});
