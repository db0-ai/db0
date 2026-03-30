import type { Db0Backend, MemoryEntry, MemoryEdge } from "@db0-ai/core";
import { generateId, defaultEmbeddingFn, cosineSimilarity } from "@db0-ai/core";

export interface ApiContext {
  backend: Db0Backend;
  agentId?: string;
  userId?: string;
  embeddingFn: (text: string) => Promise<Float32Array>;
}

export interface MemoryWithEdges extends MemoryEntry {
  edges: MemoryEdge[];
}

export interface MemoryStats {
  total: number;
  byScope: Record<string, number>;
  byStatus: Record<string, number>;
  bySourceType: Record<string, number>;
  byExtractionMethod: Record<string, number>;
  activity: {
    newestAt: string | null;
    oldestAt: string | null;
    last24h: number;
    last7d: number;
  };
}

export interface MemoryExplain {
  id: string;
  scope: string;
  status: string;
  tags: string[];
  hasSummary: boolean;
  supersedes: string | null;
  chainDepth: number;
  edgeCounts: Record<string, number>;
  sourceType: string | null;
  extractionMethod: string | null;
  validTo: string | null;
  qualitySignals: {
    corrected: boolean;
    confirmed: boolean;
    contradictionCandidate: boolean;
  };
  query?: {
    text: string;
    similarity: number;
  };
}

export interface IntegrityReport {
  generatedAt: string;
  stats: MemoryStats;
  anomalies: Array<{ type: string; count: number; sampleIds: string[] }>;
}

export async function listMemories(
  ctx: ApiContext,
  params: { scope?: string; status?: string; limit?: number; offset?: number },
): Promise<{ memories: MemoryEntry[]; total: number }> {
  const agentId = ctx.agentId ?? "*";
  let all: MemoryEntry[];

  if (agentId === "*") {
    // No way to list across agents with current backend — list common scopes
    all = [];
  } else {
    all = await ctx.backend.memoryList(agentId, params.scope as any);
  }

  // Apply filters
  let filtered = all;
  if (params.status) {
    filtered = filtered.filter((m) => m.status === params.status);
  }
  if (ctx.userId) {
    filtered = filtered.filter((m) => m.userId === ctx.userId);
  }

  const total = filtered.length;
  const offset = params.offset ?? 0;
  const limit = params.limit ?? 50;
  const memories = filtered.slice(offset, offset + limit);

  return { memories, total };
}

export async function getMemory(
  ctx: ApiContext,
  id: string,
): Promise<MemoryWithEdges | null> {
  const entry = await ctx.backend.memoryGet(id);
  if (!entry) return null;

  const edges = await ctx.backend.memoryGetEdges(id);
  return { ...entry, edges };
}

export async function getSupersedChain(
  ctx: ApiContext,
  id: string,
): Promise<MemoryEntry[]> {
  const chain: MemoryEntry[] = [];
  let current = await ctx.backend.memoryGet(id);
  if (!current) return chain;
  chain.push(current);

  // Walk backwards via supersedes
  while (current?.supersedes) {
    const prev = await ctx.backend.memoryGet(current.supersedes);
    if (!prev) break;
    chain.push(prev);
    current = prev;
  }

  return chain;
}

export async function correctMemory(
  ctx: ApiContext,
  id: string,
  body: { content: string; tags?: string[]; metadata?: Record<string, unknown> },
): Promise<MemoryEntry> {
  const old = await ctx.backend.memoryGet(id);
  if (!old) throw new Error(`Memory ${id} not found`);

  const embedding = await ctx.embeddingFn(
    typeof body.content === "string" ? body.content : JSON.stringify(body.content),
  );

  return ctx.backend.memoryWrite(old.agentId, old.sessionId, old.userId, {
    content: body.content,
    scope: old.scope,
    embedding,
    tags: [...(body.tags ?? old.tags), "user-corrected"],
    metadata: {
      ...(body.metadata ?? old.metadata),
      correctedAt: new Date().toISOString(),
      correctedFrom: id,
    },
    supersedes: id,
    expectedVersion: old.version,
  });
}

export async function confirmMemory(
  ctx: ApiContext,
  id: string,
): Promise<MemoryEntry> {
  const old = await ctx.backend.memoryGet(id);
  if (!old) throw new Error(`Memory ${id} not found`);

  const contentStr = typeof old.content === "string"
    ? old.content
    : JSON.stringify(old.content);
  const embedding = await ctx.embeddingFn(contentStr);

  return ctx.backend.memoryWrite(old.agentId, old.sessionId, old.userId, {
    content: old.content,
    scope: old.scope,
    embedding,
    tags: [...old.tags.filter((t) => t !== "user-confirmed"), "user-confirmed"],
    metadata: {
      ...old.metadata,
      confirmedAt: new Date().toISOString(),
    },
    supersedes: id,
    expectedVersion: old.version,
  });
}

export async function deleteMemory(
  ctx: ApiContext,
  id: string,
): Promise<void> {
  await ctx.backend.memoryDelete(id);
}

export async function searchMemories(
  ctx: ApiContext,
  body: { query: string; scope?: string; limit?: number },
): Promise<MemoryEntry[]> {
  const agentId = ctx.agentId;
  if (!agentId) return [];

  const embedding = await ctx.embeddingFn(body.query);
  return ctx.backend.memorySearch(agentId, null, ctx.userId ?? null, {
    embedding,
    queryText: body.query,
    scope: body.scope as any,
    scoring: "rrf",
    limit: body.limit ?? 20,
    minScore: 0,
  });
}

export async function getStats(ctx: ApiContext): Promise<MemoryStats> {
  const agentId = ctx.agentId;
  const empty: MemoryStats = { total: 0, byScope: {}, byStatus: {}, bySourceType: {}, byExtractionMethod: {}, activity: { newestAt: null, oldestAt: null, last24h: 0, last7d: 0 } };
  if (!agentId) return empty;

  const all = await ctx.backend.memoryList(agentId);
  const byScope: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const bySourceType: Record<string, number> = {};
  const byExtractionMethod: Record<string, number> = {};

  const now = Date.now();
  const d24h = 24 * 60 * 60 * 1000;
  const d7d = 7 * d24h;
  let newestAt: string | null = null;
  let oldestAt: string | null = null;
  let last24h = 0;
  let last7d = 0;

  for (const m of all) {
    byScope[m.scope] = (byScope[m.scope] ?? 0) + 1;
    byStatus[m.status] = (byStatus[m.status] ?? 0) + 1;
    const st = m.sourceType ?? "unknown";
    bySourceType[st] = (bySourceType[st] ?? 0) + 1;
    const em = m.extractionMethod ?? "unknown";
    byExtractionMethod[em] = (byExtractionMethod[em] ?? 0) + 1;

    if (m.createdAt) {
      if (!newestAt || m.createdAt > newestAt) newestAt = m.createdAt;
      if (!oldestAt || m.createdAt < oldestAt) oldestAt = m.createdAt;
      const age = now - new Date(m.createdAt).getTime();
      if (age <= d24h) last24h++;
      if (age <= d7d) last7d++;
    }
  }

  return { total: all.length, byScope, byStatus, bySourceType, byExtractionMethod, activity: { newestAt, oldestAt, last24h, last7d } };
}

export async function explainMemory(
  ctx: ApiContext,
  id: string,
  query?: string,
): Promise<MemoryExplain | null> {
  const memory = await getMemory(ctx, id);
  if (!memory) return null;
  const chain = await getSupersedChain(ctx, id);
  const edgeCounts: Record<string, number> = {};
  for (const e of memory.edges) {
    edgeCounts[e.edgeType] = (edgeCounts[e.edgeType] ?? 0) + 1;
  }

  const out: MemoryExplain = {
    id: memory.id,
    scope: memory.scope,
    status: memory.status,
    tags: memory.tags,
    hasSummary: Boolean(memory.summary),
    supersedes: memory.supersedes,
    chainDepth: chain.length,
    edgeCounts,
    sourceType: memory.sourceType ?? null,
    extractionMethod: memory.extractionMethod ?? null,
    validTo: memory.validTo ?? null,
    qualitySignals: {
      corrected: memory.tags.includes("user-corrected"),
      confirmed: memory.tags.includes("user-confirmed"),
      contradictionCandidate: memory.tags.includes("contradiction-candidate"),
    },
  };

  if (query && query.trim().length > 0) {
    const queryEmbedding = await ctx.embeddingFn(query);
    const similarity = safeCosine(queryEmbedding, memory.embedding);
    out.query = { text: query, similarity };
  }

  return out;
}

export async function getIntegrityReport(ctx: ApiContext): Promise<IntegrityReport> {
  const stats = await getStats(ctx);
  const agentId = ctx.agentId;
  const all = agentId ? await ctx.backend.memoryList(agentId) : [];

  const contradictions = all.filter((m) => m.tags.includes("contradiction-candidate"));
  const missingSummaries = all.filter((m) => m.status === "active" && !m.summary);
  const missingScope = all.filter((m) => !m.scope);
  const missingProvenance = all.filter((m) => m.status === "active" && !m.sourceType && !m.extractionMethod);
  const staleSuperseded = all.filter((m) => m.status === "superseded" && !m.validTo);

  return {
    generatedAt: new Date().toISOString(),
    stats,
    anomalies: [
      {
        type: "contradiction-candidates",
        count: contradictions.length,
        sampleIds: contradictions.slice(0, 5).map((m) => m.id),
      },
      {
        type: "active-without-summary",
        count: missingSummaries.length,
        sampleIds: missingSummaries.slice(0, 5).map((m) => m.id),
      },
      {
        type: "missing-scope",
        count: missingScope.length,
        sampleIds: missingScope.slice(0, 5).map((m) => m.id),
      },
      {
        type: "missing-provenance",
        count: missingProvenance.length,
        sampleIds: missingProvenance.slice(0, 5).map((m) => m.id),
      },
      {
        type: "superseded-without-validTo",
        count: staleSuperseded.length,
        sampleIds: staleSuperseded.slice(0, 5).map((m) => m.id),
      },
    ],
  };
}

export interface ExportData {
  version: 1;
  exportedAt: string;
  agentId: string;
  memories: Array<{
    id: string;
    content: unknown;
    scope: string;
    tags: string[];
    metadata: Record<string, unknown>;
    createdAt: string;
    status: string;
    version: number;
    summary: string | null;
    sourceType: string | null;
    extractionMethod: string | null;
    confidence: number | null;
    supersedes: string | null;
    validTo: string | null;
    sessionId: string | null;
    userId: string | null;
    embedding: number[];
  }>;
  edges: Array<{
    sourceId: string;
    targetId: string;
    edgeType: string;
    metadata: Record<string, unknown>;
  }>;
}

// === Consolidation ===

export interface ConsolidationGroup {
  memories: Array<{
    id: string;
    content: string;
    scope: string;
    tags: string[];
    createdAt: string;
  }>;
  avgSimilarity: number;
}

export interface ConsolidationHistory {
  id: string;
  content: string;
  mergedFrom: string[];
  originalContents: string[];
  consolidatedAt: string;
  clusterSize: number;
}

/**
 * Find clusters of similar memories that could be consolidated.
 * These are candidates — semantically similar but not yet merged.
 */
export async function getConsolidationCandidates(
  ctx: ApiContext,
  params?: { threshold?: number; minCluster?: number },
): Promise<ConsolidationGroup[]> {
  const agentId = ctx.agentId;
  if (!agentId) return [];

  const all = await ctx.backend.memoryList(agentId);
  const active = all.filter(
    (m) =>
      m.status === "active" &&
      !m.tags.includes("file-chunk") &&
      !m.tags.includes("file-snapshot") &&
      m.embedding != null &&
      m.extractionMethod !== "consolidate",
  );

  const threshold = params?.threshold ?? 0.75;
  const minCluster = params?.minCluster ?? 2;

  // Greedy clustering
  const visited = new Set<string>();
  const groups: ConsolidationGroup[] = [];

  for (const mem of active) {
    if (visited.has(mem.id)) continue;
    const cluster = [mem];
    visited.add(mem.id);
    let totalSim = 0;
    let simCount = 0;

    for (const other of active) {
      if (visited.has(other.id)) continue;
      const sim = safeCosine(mem.embedding, other.embedding);
      if (sim >= threshold) {
        cluster.push(other);
        visited.add(other.id);
        totalSim += sim;
        simCount++;
      }
    }

    if (cluster.length >= minCluster) {
      groups.push({
        memories: cluster.map((m) => ({
          id: m.id,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
          scope: m.scope,
          tags: m.tags,
          createdAt: m.createdAt,
        })),
        avgSimilarity: simCount > 0 ? totalSim / simCount : 1,
      });
    }
  }

  return groups.sort((a, b) => b.memories.length - a.memories.length);
}

/**
 * Get consolidation history — memories created via consolidation,
 * with their original source memories.
 */
export async function getConsolidationHistory(
  ctx: ApiContext,
): Promise<ConsolidationHistory[]> {
  const agentId = ctx.agentId;
  if (!agentId) return [];

  const all = await ctx.backend.memoryList(agentId);
  const consolidated = all.filter((m) => m.extractionMethod === "consolidate" && m.status === "active");

  const history: ConsolidationHistory[] = [];

  for (const mem of consolidated) {
    const mergedFrom = (mem.metadata?.mergedFrom as string[]) ?? [];
    const originalContents: string[] = [];

    for (const origId of mergedFrom) {
      const orig = await ctx.backend.memoryGet(origId);
      if (orig) {
        originalContents.push(
          typeof orig.content === "string" ? orig.content : JSON.stringify(orig.content),
        );
      }
    }

    history.push({
      id: mem.id,
      content: typeof mem.content === "string" ? mem.content : JSON.stringify(mem.content),
      mergedFrom,
      originalContents,
      consolidatedAt: (mem.metadata?.consolidatedAt as string) ?? mem.createdAt,
      clusterSize: (mem.metadata?.clusterSize as number) ?? mergedFrom.length,
    });
  }

  return history.sort((a, b) => b.consolidatedAt.localeCompare(a.consolidatedAt));
}

export async function exportMemories(ctx: ApiContext): Promise<ExportData> {
  const agentId = ctx.agentId;
  if (!agentId) throw new Error("No agentId configured");

  const all = await ctx.backend.memoryList(agentId);
  const edgeSet = new Map<string, { sourceId: string; targetId: string; edgeType: string; metadata: Record<string, unknown> }>();

  const memories = [];
  for (const m of all) {
    memories.push({
      id: m.id,
      content: m.content,
      scope: m.scope,
      tags: m.tags,
      metadata: m.metadata,
      createdAt: m.createdAt,
      status: m.status,
      version: m.version,
      summary: m.summary,
      sourceType: m.sourceType,
      extractionMethod: m.extractionMethod,
      confidence: m.confidence,
      supersedes: m.supersedes,
      validTo: m.validTo,
      sessionId: m.sessionId,
      userId: m.userId,
      embedding: Array.from(m.embedding),
    });

    const edges = await ctx.backend.memoryGetEdges(m.id);
    for (const e of edges) {
      edgeSet.set(e.id, { sourceId: e.sourceId, targetId: e.targetId, edgeType: e.edgeType, metadata: e.metadata });
    }
  }

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    agentId,
    memories,
    edges: Array.from(edgeSet.values()),
  };
}

export async function importMemories(
  ctx: ApiContext,
  data: ExportData,
): Promise<{ imported: number; skipped: number; edges: number }> {
  let imported = 0;
  let skipped = 0;
  let edgeCount = 0;

  for (const m of data.memories) {
    // Check if already exists
    const existing = await ctx.backend.memoryGet(m.id);
    if (existing) { skipped++; continue; }

    const embedding = new Float32Array(m.embedding);
    await ctx.backend.memoryWrite(
      data.agentId,
      m.sessionId,
      m.userId,
      {
        content: m.content as string,
        scope: m.scope as any,
        embedding,
        tags: m.tags,
        metadata: m.metadata,
        summary: m.summary ?? undefined,
        sourceType: m.sourceType as any,
        extractionMethod: m.extractionMethod as any,
        confidence: m.confidence ?? undefined,
        supersedes: m.supersedes ?? undefined,
      },
    );
    imported++;
  }

  // Restore edges
  for (const e of (data.edges || [])) {
    try {
      await ctx.backend.memoryAddEdge({
        sourceId: e.sourceId,
        targetId: e.targetId,
        edgeType: e.edgeType as any,
        metadata: e.metadata,
      });
      edgeCount++;
    } catch {
      // Edge target may not exist, skip
    }
  }

  return { imported, skipped, edges: edgeCount };
}

function safeCosine(a: Float32Array, b: Float32Array): number {
  if (a.length === 0 || b.length === 0) return 0;
  if (a.length === b.length) return cosineSimilarity(a, b);

  const n = Math.min(a.length, b.length);
  const aa = new Float32Array(n);
  const bb = new Float32Array(n);
  aa.set(a.slice(0, n));
  bb.set(b.slice(0, n));
  return cosineSimilarity(aa, bb);
}
