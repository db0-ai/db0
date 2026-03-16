import type {
  BatchEmbeddingFn,
  ContextIngestOpts,
  ContextIngestResult,
  ContextPackOpts,
  ContextPackResult,
  ContextPreserveOpts,
  ContextPreserveResult,
  ContextReconcileOpts,
  ContextReconcileResult,
  Db0Profile,
  EmbeddingFn,
  MemoryExtractionMethod,
  MemorySearchResult,
  MemorySourceType,
  PreserveMessage,
} from "../types.js";
import { extractEntities } from "../extraction/index.js";
import type { Harness } from "../harness.js";

/**
 * Context — the core context lifecycle primitive.
 *
 * Provides four verbs that map to the agent context lifecycle:
 * - `ingest()` — write a single fact with dedup, contradiction detection, entity enrichment
 * - `pack()` — assemble relevant context for a query within a token budget
 * - `preserve()` — batch-extract and batch-embed facts from conversation messages
 * - `reconcile()` — background maintenance (promote, merge, clean)
 *
 * Created via `harness.context()`. Requires an embedding function.
 */
export class Context {
  private harness: Harness;
  private embeddingFn: EmbeddingFn;
  private batchEmbeddingFn: BatchEmbeddingFn;
  private profile: Db0Profile;

  constructor(
    harness: Harness,
    embeddingFn: EmbeddingFn,
    batchEmbeddingFn: BatchEmbeddingFn,
    profile: Db0Profile,
  ) {
    this.harness = harness;
    this.embeddingFn = embeddingFn;
    this.batchEmbeddingFn = batchEmbeddingFn;
    this.profile = profile;
  }

  /**
   * Write a single fact with quality checks:
   * 1. Embed the content
   * 2. Search for near-duplicates (score >= 0.78)
   * 3. Skip if exact duplicate found (normalized text match)
   * 4. Detect contradiction (negation mismatch on high-similarity match)
   * 5. Extract named entities and add as tags
   * 6. Write with entity metadata and optional contradiction edge
   */
  async ingest(content: string, opts: ContextIngestOpts): Promise<ContextIngestResult> {
    const embedding = opts.embedding ?? await this.embeddingFn(content);
    const normalized = normalizeText(content);

    // Search for near-duplicates
    const existing = await this.harness.memory().search({
      embedding,
      scope: opts.scope,
      limit: 5,
      minScore: 0.78,
    });

    // Exact duplicate check
    const exact = existing.find((m) => {
      const c = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return normalizeText(c) === normalized;
    });
    if (exact) {
      return { deduped: true, contradictionLinked: false, id: null };
    }

    // Contradiction detection
    const contradictionTarget = existing.find((m) => {
      const c = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return m.score > 0.7 && hasNegation(c) !== hasNegation(content);
    });

    // Entity extraction
    const entities = extractEntities(content);
    const entityNames = entities.map((e) => e.text);
    const entityTags = entities.map((e) => `entity:${e.type}:${e.text.toLowerCase()}`);

    const baseTags = opts.tags ?? [];
    const tags = contradictionTarget
      ? [...baseTags, ...entityTags, "contradiction-candidate"]
      : [...baseTags, ...entityTags];

    const entry = await this.harness.memory().write({
      content,
      scope: opts.scope,
      embedding,
      tags,
      metadata: {
        source: "context-engine",
        quality: "v1",
        ingestedAt: new Date().toISOString(),
        ...(entityNames.length > 0 ? { entities: entityNames } : {}),
      },
      sourceType: opts.sourceType,
      extractionMethod: opts.extractionMethod,
      confidence: opts.confidence,
    });

    // Link contradiction edge
    if (contradictionTarget) {
      try {
        await this.harness.memory().addEdge({
          sourceId: entry.id,
          targetId: contradictionTarget.id,
          edgeType: "contradicts",
          metadata: {
            score: contradictionTarget.score,
            reason: "negation-mismatch",
          },
        });
      } catch {
        // Non-fatal
      }
      return { deduped: false, contradictionLinked: true, id: entry.id };
    }

    return { deduped: false, contradictionLinked: false, id: entry.id };
  }

  /**
   * Assemble relevant context for a query within a token budget.
   *
   * 1. Embed the query
   * 2. Search memories with profile-configured scoring/weights
   * 3. Optionally collect edges between result memories
   * 4. Format into budget-aware text with relationship annotations
   */
  async pack(query: string, opts?: ContextPackOpts): Promise<ContextPackResult> {
    const retrieval = this.profile.retrieval ?? {};
    const contextCfg = this.profile.context ?? {};

    const embedding = opts?.embedding ?? await this.embeddingFn(query);
    const scopes = opts?.scopes ?? ["user", "agent"];
    const maxItems = opts?.maxItems ?? contextCfg.maxPackItems ?? retrieval.topK ?? 8;
    const minScore = opts?.minScore ?? retrieval.minScore ?? 0.4;
    const includeEdges = opts?.includeEdges ?? contextCfg.includeEdges ?? true;
    const tokenBudget = opts?.tokenBudget;

    // Build search options from profile
    const searchOpts: Parameters<ReturnType<Harness["memory"]>["search"]>[0] = {
      embedding,
      scope: scopes,
      limit: maxItems * 2, // Over-fetch to allow for dedup
      minScore,
      scoring: retrieval.scoring,
      hybridWeights: retrieval.hybridWeights,
      decayHalfLifeDays: retrieval.decayHalfLifeDays,
    };

    if (retrieval.graphExpand?.enabled) {
      searchOpts.graphExpand = {
        maxExpand: retrieval.graphExpand.maxExpand,
        edgeTypes: retrieval.graphExpand.edgeTypes,
        boostFactor: retrieval.graphExpand.boostFactor,
      };
    }

    const rawMemories = await this.harness.memory().search(searchOpts);

    // Deduplicate by content — databases with repeated file-chunk indexing
    // may contain duplicate entries with identical content.
    const seen = new Set<string>();
    const memories: MemorySearchResult[] = [];
    for (const m of rawMemories) {
      const key = typeof m.content === "string"
        ? m.content.slice(0, 200)
        : JSON.stringify(m.content).slice(0, 200);
      if (!seen.has(key)) {
        seen.add(key);
        memories.push(m);
      }
      if (memories.length >= maxItems) break;
    }

    // Collect edges for annotation
    let edges: Map<string, Array<{ targetId: string; edgeType: string }>> | undefined;
    if (includeEdges && memories.length > 0) {
      edges = await this.collectEdges(memories);
    }

    // Format within budget
    const text = formatMemories(memories, tokenBudget, edges);
    const estimatedTokens = Math.ceil(text.length / 4);

    return {
      text,
      count: memories.length,
      estimatedTokens,
      memories,
    };
  }

  /**
   * Batch-extract and batch-embed facts from conversation messages.
   *
   * Designed for pre-compaction preservation:
   * 1. Extract facts from all messages using the harness extraction strategy
   * 2. Collect all fact content strings
   * 3. Batch-embed all at once (single call to batchEmbeddingFn)
   * 4. For each fact: dedup, check contradiction, write
   *
   * This is the most embedding-intensive operation — batch embedding is critical.
   */
  async preserve(
    messages: PreserveMessage[],
    opts?: ContextPreserveOpts,
  ): Promise<ContextPreserveResult> {
    const scope = opts?.scope ?? "user";
    const extraTags = opts?.tags ?? [];
    const extraction = this.harness.extraction();

    // Step 1: Extract facts from all messages (CPU-only, fast)
    const allFacts: Array<{ content: string; tags: string[]; sourceType?: MemorySourceType; extractionMethod?: MemoryExtractionMethod }> = [];
    for (const msg of messages) {
      const extracted = await extraction.extract(msg.content);
      for (const fact of extracted) {
        allFacts.push({
          content: fact.content,
          tags: [...fact.tags, ...extraTags, "preserved"],
          sourceType: fact.sourceType,
          extractionMethod: fact.extractionMethod,
        });
      }
    }

    if (allFacts.length === 0) {
      return { extracted: 0, deduped: 0, contradictions: 0 };
    }

    // Step 2: Batch-embed all fact contents at once
    const contents = allFacts.map((f) => f.content);
    const embeddings = await this.batchEmbeddingFn(contents);

    // Step 3: For each fact, ingest with pre-computed embedding
    let deduped = 0;
    let contradictions = 0;

    for (let i = 0; i < allFacts.length; i++) {
      const result = await this.ingest(allFacts[i].content, {
        scope,
        tags: allFacts[i].tags,
        embedding: embeddings[i],
        sourceType: allFacts[i].sourceType,
        extractionMethod: allFacts[i].extractionMethod ?? "preserve",
      });
      if (result.deduped) deduped++;
      if (result.contradictionLinked) contradictions++;
    }

    return {
      extracted: allFacts.length,
      deduped,
      contradictions,
    };
  }

  /**
   * Background maintenance — promote, merge, clean.
   *
   * 1. Promote frequently-accessed file-chunks to durable user-scoped memories
   * 2. Merge exact-duplicate facts (supersede the older one)
   * 3. Clean stale contradiction edges (where one side was superseded)
   */
  async reconcile(opts?: ContextReconcileOpts): Promise<ContextReconcileResult> {
    const cfg = this.profile.reconciliation ?? {};
    const threshold = opts?.promotionThreshold ?? cfg.promotionThreshold ?? 3;
    const batchSize = opts?.batchSize ?? cfg.batchSize ?? 20;

    let promoted = 0;
    let merged = 0;
    let contradictionsCleaned = 0;

    // Step 1: Promote frequently-accessed file-chunks
    const allMemories = await this.harness.memory().list("user");
    const fileChunks = allMemories
      .filter(
        (m) =>
          m.tags.includes("file-chunk") &&
          m.accessCount >= threshold &&
          m.status === "active",
      )
      .slice(0, batchSize);

    const extraction = this.harness.extraction();
    for (const chunk of fileChunks) {
      const content =
        typeof chunk.content === "string"
          ? chunk.content
          : JSON.stringify(chunk.content);
      const extracted = await extraction.extract(content);
      for (const fact of extracted) {
        const result = await this.ingest(fact.content, {
          scope: fact.scope,
          tags: [...fact.tags, "tier-3", "promoted-from-chunk"],
          sourceType: fact.sourceType ?? "compaction",
          extractionMethod: fact.extractionMethod ?? "reconcile",
        });
        if (!result.deduped) promoted++;
      }
    }

    // Step 2: Merge near-duplicate facts
    const activeFacts = allMemories
      .filter(
        (m) =>
          m.status === "active" &&
          !m.tags.includes("file-chunk") &&
          !m.tags.includes("file-snapshot"),
      )
      .slice(0, batchSize);

    for (const fact of activeFacts) {
      const similar = await this.harness.memory().search({
        embedding: fact.embedding,
        scope: fact.scope,
        limit: 5,
        minScore: 0.85,
      });

      const factContent = normalizeText(
        typeof fact.content === "string"
          ? fact.content
          : JSON.stringify(fact.content),
      );

      for (const match of similar) {
        if (match.id === fact.id) continue;
        if (
          match.tags.includes("file-chunk") ||
          match.tags.includes("file-snapshot")
        )
          continue;

        const matchContent = normalizeText(
          typeof match.content === "string"
            ? match.content
            : JSON.stringify(match.content),
        );

        if (factContent === matchContent) {
          const older =
            Date.parse(fact.createdAt) < Date.parse(match.createdAt)
              ? fact
              : match;
          const newer = older === fact ? match : fact;
          try {
            await this.harness.memory().write({
              content: newer.content,
              scope: newer.scope,
              embedding: newer.embedding,
              tags: newer.tags,
              supersedes: older.id,
              sourceType: newer.sourceType ?? "compaction",
              extractionMethod: "reconcile",
              metadata: {
                ...(newer.metadata ?? {}),
                mergedFrom: older.id,
                mergeReason: "tier3-dedup",
              },
            });
            merged++;
          } catch {
            // Version conflict or already superseded
          }
          break; // only merge once per fact
        }
      }
    }

    // Step 3: Clean stale contradiction edges
    const contradictionCandidates = allMemories.filter(
      (m) =>
        m.status === "active" && m.tags.includes("contradiction-candidate"),
    );

    for (const mem of contradictionCandidates.slice(0, batchSize)) {
      const edges = await this.harness.memory().getEdges(mem.id);
      for (const edge of edges) {
        if (edge.edgeType !== "contradicts") continue;
        const otherId =
          edge.sourceId === mem.id ? edge.targetId : edge.sourceId;
        const other = await this.harness.memory().get(otherId);
        if (other && other.status === "superseded") {
          try {
            await this.harness.memory().deleteEdge(edge.id);
            contradictionsCleaned++;
          } catch {
            // Non-fatal
          }
        }
      }
    }

    return { promoted, merged, contradictionsCleaned };
  }

  // === Private helpers ===

  private async collectEdges(
    memories: MemorySearchResult[],
  ): Promise<Map<string, Array<{ targetId: string; edgeType: string }>>> {
    const edgeMap = new Map<
      string,
      Array<{ targetId: string; edgeType: string }>
    >();
    const memoryIds = new Set(memories.map((m) => m.id));

    for (const mem of memories) {
      try {
        const edges = await this.harness.memory().getEdges(mem.id);
        const relevant = edges.filter(
          (e) => memoryIds.has(e.sourceId) || memoryIds.has(e.targetId),
        );
        if (relevant.length > 0) {
          edgeMap.set(
            mem.id,
            relevant.map((e) => ({
              targetId: e.sourceId === mem.id ? e.targetId : e.sourceId,
              edgeType: e.edgeType,
            })),
          );
        }
      } catch {
        // Edge query failed — skip
      }
    }

    return edgeMap;
  }
}

// === Module-level helpers ===

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function hasNegation(text: string): boolean {
  const lower = text.toLowerCase();
  const negationWords = [
    "not",
    "don't",
    "doesn't",
    "never",
    "no longer",
    "instead of",
    "changed from",
    "unlike",
  ];
  return negationWords.some((w) => lower.includes(w));
}

/**
 * Format memories into budget-aware text with optional edge annotations.
 * Each memory is rendered as a numbered line with scope and score.
 * Edge annotations show relationships to other memories in the set.
 */
export function formatMemories(
  memories: MemorySearchResult[],
  tokenBudget?: number,
  edges?: Map<string, Array<{ targetId: string; edgeType: string }>>,
): string {
  const header = "## Relevant Memory\n";
  const lines: string[] = [];
  let estimatedTokens = header.length / 4;

  // Build id→index map for edge references
  const idToIndex = new Map<string, number>();
  memories.forEach((m, i) => idToIndex.set(m.id, i + 1));

  for (let i = 0; i < memories.length; i++) {
    const mem = memories[i];
    const display =
      mem.summary ??
      (typeof mem.content === "string"
        ? mem.content
        : JSON.stringify(mem.content));
    let line = `- [${i + 1}] [${mem.scope}] ${display} (score: ${mem.score.toFixed(2)})`;

    // Append relationship annotations
    const memEdges = edges?.get(mem.id);
    if (memEdges && memEdges.length > 0) {
      const annotations = memEdges
        .map((e) => {
          const targetIdx = idToIndex.get(e.targetId);
          return targetIdx ? `${e.edgeType} [${targetIdx}]` : null;
        })
        .filter(Boolean);
      if (annotations.length > 0) {
        line += ` {${annotations.join(", ")}}`;
      }
    }

    const lineTokens = line.length / 4;
    if (tokenBudget && estimatedTokens + lineTokens > tokenBudget) {
      break;
    }

    lines.push(line);
    estimatedTokens += lineTokens;
  }

  return header + lines.join("\n");
}
