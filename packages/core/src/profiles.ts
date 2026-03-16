/**
 * Built-in Profile Presets for db0
 *
 * Profiles bundle all tunable knobs for the memory engine into named
 * configurations optimized for specific workloads — like `postgresql.conf`
 * tuning templates or MySQL workload profiles.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { db0 } from "@db0-ai/openclaw";
 *
 * // Use a built-in preset by name
 * const engine = db0({ profile: "agent-context" });
 *
 * // Or customize a preset
 * import { mergeProfiles, PROFILE_AGENT_CONTEXT } from "@db0-ai/core";
 * const myProfile = mergeProfiles(PROFILE_AGENT_CONTEXT, {
 *   retrieval: { topK: 12, decayHalfLifeDays: 21 },
 * });
 * const engine = db0({ profile: myProfile });
 * ```
 *
 * ## How to Choose a Profile
 *
 * ```
 *                          ┌─────────────────────┐
 *                          │  What's your input?  │
 *                          └─────────┬───────────┘
 *                    ┌───────────────┼───────────────┐
 *                    ▼               ▼               ▼
 *             Conversations     Documents      Curated Files
 *            (chat, support)  (articles, wiki) (memory/*.md)
 *                    │               │               │
 *              ┌─────┴─────┐         │               │
 *              ▼           ▼         ▼               ▼
 *          Pure Chat   Agent w/   knowledge-    curated-memory
 *          (no files)  files      base
 *              │           │
 *              ▼           ▼
 *        conversational  agent-context
 * ```
 *
 * ### Decision Matrix
 *
 * | Workload                  | Profile           | Key characteristics                        |
 * |---------------------------|-------------------|--------------------------------------------|
 * | Chatbot / support agent   | `conversational`  | High recency, session ingest, fast decay   |
 * | Agent + context engine    | `agent-context`   | Balanced hybrid, enrichment, graph expand  |
 * | Document retrieval / wiki | `knowledge-base`  | Chunk + enrich, query expansion, slow decay|
 * | IDE / code assistant      | `coding-assistant` | High precision, no enrichment, long decay  |
 * | Claude Code memory files  | `curated-memory`  | Near-zero decay, manual extraction, precise|
 * | Benchmark / research      | `high-recall`     | Low thresholds, expansion, large top-K     |
 * | Testing / resource-limited| `minimal`         | Pure similarity, no LLM calls              |
 *
 * ### Knob-by-Knob Comparison
 *
 * | Knob                 | conversational | agent-context | knowledge-base | coding-assistant | curated-memory | high-recall | minimal |
 * |----------------------|:--------------:|:-------------:|:--------------:|:----------------:|:--------------:|:-----------:|:-------:|
 * | ingest.mode          | session        | chunk         | chunk          | session          | chunk          | chunk       | session |
 * | ingest.enrich        | —              | yes           | yes            | —                | —              | yes         | —       |
 * | ingest.enrichMode    | —              | augment       | rewrite        | —                | —              | augment     | —       |
 * | ingest.latentBridging| —              | —             | yes            | —                | yes            | yes         | —       |
 * | retrieval.topK       | 10             | 8             | 8              | 5                | 8              | 15          | 5       |
 * | retrieval.minScore   | 0.40           | 0.40          | 0.35           | 0.45             | 0.45           | 0.25        | 0.40    |
 * | retrieval.scoring    | hybrid         | hybrid        | hybrid         | hybrid           | hybrid         | hybrid      | sim     |
 * | hybridWeights.sim    | 0.50           | 0.65          | 0.80           | 0.85             | 0.90           | 0.60        | —       |
 * | hybridWeights.rec    | 0.35           | 0.20          | 0.10           | 0.10             | 0.05           | 0.25        | —       |
 * | hybridWeights.pop    | 0.15           | 0.15          | 0.10           | 0.05             | 0.05           | 0.15        | —       |
 * | decayHalfLifeDays    | 7              | 14            | 30             | 30               | 90             | 14          | —       |
 * | queryExpansion       | —              | —             | yes            | —                | —              | yes         | —       |
 * | graphExpand.enabled  | yes            | yes           | yes            | —                | —              | yes         | —       |
 * | graphExpand.maxExpand | 3             | 3             | 5              | —                | —              | 5           | —       |
 * | extraction.strategy  | rules          | rules         | rules          | rules            | manual         | rules       | rules   |
 * | reconciliation       | —              | auto/25       | —              | —                | —              | —           | —       |
 * | context.budgetRatio  | 0.15           | 0.15          | 0.20           | 0.10             | 0.15           | 0.25        | 0.10    |
 * | context.includeEdges | yes            | yes           | yes            | —                | —              | yes         | —       |
 *
 * ## Customizing Profiles
 *
 * Use `mergeProfiles()` to layer overrides onto a preset:
 *
 * ```typescript
 * import { mergeProfiles, PROFILE_AGENT_CONTEXT } from "@db0-ai/core";
 *
 * // Start from agent-context, but increase top-K and slow down decay
 * const custom = mergeProfiles(PROFILE_AGENT_CONTEXT, {
 *   retrieval: {
 *     topK: 12,
 *     decayHalfLifeDays: 21,
 *     hybridWeights: { recency: 0.3 },  // only overrides recency; sim/pop preserved
 *   },
 * });
 * ```
 *
 * `mergeProfiles` deep-merges up to 3 levels, so you can override individual
 * hybridWeights without losing the others. Arrays (like `edgeTypes`) are
 * replaced, not concatenated.
 */
import type { Db0Profile } from "./types.js";

// ─── Conversational ─────────────────────────────────────────────────────────

/**
 * **Conversational** — optimized for chat-based agents.
 *
 * Best for: chatbots, customer support agents, social companions, therapist
 * bots, or any application where the primary input is user↔agent conversation.
 *
 * Key design decisions:
 * - **Session ingest** preserves full conversational flow, speaker turns, and
 *   temporal order. Chunking would lose "who said what when".
 * - **High recency weight (0.35)** because in conversation, what was just said
 *   is usually more relevant than what was said last week.
 * - **Short decay (7 days)** — conversational context goes stale quickly.
 *   A support ticket from 2 weeks ago rarely helps with today's issue.
 * - **No enrichment** — sessions are already self-contained with full context.
 * - **Graph expansion enabled** — conversational follow-ups often reference
 *   related topics ("what about that other thing we discussed?").
 *
 * When to use something else:
 * - If the agent also indexes files/documents → use `agent-context`
 * - If you need to find specific facts across many sessions → use `knowledge-base`
 */
export const PROFILE_CONVERSATIONAL: Db0Profile = {
  name: "conversational",
  description: "Chat-based agents — prioritizes recency and conversational flow",
  ingest: {
    mode: "session",
    enrich: false,
  },
  retrieval: {
    topK: 10,
    minScore: 0.4,
    scoring: "hybrid",
    hybridWeights: { similarity: 0.5, recency: 0.35, popularity: 0.15 },
    decayHalfLifeDays: 7,
    queryExpansion: false,
    graphExpand: { enabled: true, maxExpand: 3 },
  },
  extraction: {
    strategy: "rules",
  },
  context: {
    budgetRatio: 0.15,
    includeEdges: true,
  },
};

// ─── Agent Context ──────────────────────────────────────────────────────────

/**
 * **Agent Context** — optimized for agent context engines like OpenClaw.
 *
 * Best for: AI agent frameworks that combine conversational memory with
 * file-based knowledge (e.g., MEMORY.md, project docs, user preferences).
 * This is the recommended default for OpenClaw's db0 plugin.
 *
 * Key design decisions:
 * - **Chunk ingest with enrichment** — the agent processes both conversations
 *   and files. Chunking with augmentation handles both well: conversations
 *   get pronoun/reference resolution, and files get semantic metadata headers.
 * - **Balanced hybrid weights (0.65/0.20/0.15)** — similarity dominates, but
 *   recency still matters (recent conversations > old ones). Popularity gives
 *   a small boost to frequently-accessed facts, acting as implicit user feedback.
 * - **Moderate decay (14 days)** — a user preference mentioned 2 weeks ago is
 *   still relevant, but a debugging session from a month ago less so.
 * - **No query expansion** — agent context retrieval is latency-sensitive
 *   (it runs on every turn). The extra 200-500ms of LLM expansion isn't
 *   worth it when the agent is already waiting to respond.
 * - **Graph expansion** — agent memories are interconnected (facts link to
 *   their source conversations, contradictions flag updated preferences).
 * - **Auto-reconciliation every 25 turns** — background maintenance promotes
 *   high-value file chunks and cleans up duplicates without manual intervention.
 *
 * When to use something else:
 * - If there are no files/documents → use `conversational`
 * - If latency doesn't matter and you want maximum recall → use `high-recall`
 */
export const PROFILE_AGENT_CONTEXT: Db0Profile = {
  name: "agent-context",
  description: "Agent context engines — hybrid conversational recall + file knowledge",
  ingest: {
    mode: "chunk",
    chunkSize: 1600,
    chunkOverlap: 320,
    enrich: true,
    enrichWindowSize: 1,
  },
  retrieval: {
    topK: 8,
    minScore: 0.4,
    scoring: "hybrid",
    hybridWeights: { similarity: 0.65, recency: 0.2, popularity: 0.15 },
    decayHalfLifeDays: 14,
    queryExpansion: false,
    graphExpand: { enabled: true, maxExpand: 3 },
  },
  extraction: {
    strategy: "rules",
  },
  reconciliation: {
    autoReconcile: true,
    reconcileInterval: 25,
  },
  context: {
    budgetRatio: 0.15,
    includeEdges: true,
  },
};

// ─── Knowledge Base ─────────────────────────────────────────────────────────

/**
 * **Knowledge Base** — optimized for document and file retrieval.
 *
 * Best for: wikis, documentation search, research assistants, RAG pipelines,
 * or any application where the primary input is semi-structured documents
 * rather than live conversation.
 *
 * Key design decisions:
 * - **Chunk ingest with rewrite enrichment** — documents need to be split for
 *   precise retrieval. Unlike conversations, documents have simple pronoun chains
 *   and few speakers, making rewrite mode safe. Rewriting resolves "it", "the
 *   system", "this module" into concrete names, making each chunk self-contained.
 *   Combined with query expansion (which normalizes the query side), the semantic
 *   drift problem that plagues conversational rewriting is mitigated.
 * - **Latent Semantic Bridging enabled** — documents often have queries that are
 *   conceptual ("security concerns") rather than literal ("SQL injection"). A
 *   second embedding on inferred meaning catches these conceptual matches.
 *   Results are deduplicated by source chunk. Note: bridging hurt on LoCoMo
 *   conversational data (-10pp) because metadata is too generic for conversations,
 *   but documents have more semantically distinct chunks where this should help.
 * - **High similarity weight (0.80)** — document queries are typically
 *   content-focused ("how does X work?"), not time-sensitive.
 * - **Low recency weight (0.10)** — documents don't go stale as fast as
 *   conversations. A README written 3 months ago is still the README.
 * - **Slow decay (30 days)** — supports the low recency weight.
 * - **Query expansion enabled** — document queries tend to be open-ended
 *   ("explain the auth flow") where reformulation catches different wordings.
 *   Also bridges the semantic gap created by rewrite enrichment, since both
 *   storage and query side are LLM-normalized.
 * - **Large graph expansion (maxExpand: 5)** — documents often reference
 *   each other; following links provides comprehensive context.
 *
 * When to use something else:
 * - If content is human-curated memory files → use `curated-memory`
 * - If this is mixed with live conversation → use `agent-context`
 */
export const PROFILE_KNOWLEDGE_BASE: Db0Profile = {
  name: "knowledge-base",
  description: "Document retrieval — chunked ingestion with enrichment, broad semantic search",
  ingest: {
    mode: "chunk",
    chunkSize: 1600,
    chunkOverlap: 320,
    enrich: true,
    enrichMode: "rewrite",
    enrichWindowSize: 1,
    latentBridging: true,
  },
  retrieval: {
    topK: 8,
    minScore: 0.35,
    scoring: "hybrid",
    hybridWeights: { similarity: 0.8, recency: 0.1, popularity: 0.1 },
    decayHalfLifeDays: 30,
    queryExpansion: true,
    graphExpand: { enabled: true, maxExpand: 5 },
  },
  extraction: {
    strategy: "rules",
  },
  context: {
    budgetRatio: 0.2,
    includeEdges: true,
  },
};

// ─── Coding Assistant ───────────────────────────────────────────────────────

/**
 * **Coding Assistant** — optimized for developer-facing tools.
 *
 * Best for: IDE assistants, code review bots, pair programming agents,
 * or CLI tools that need to recall past coding sessions and decisions.
 *
 * Key design decisions:
 * - **Session ingest** — code discussions need full context preserved.
 *   Chunking a debugging session would lose the cause→effect chain.
 * - **Very high similarity weight (0.85)** — code queries are precise.
 *   "How does the auth middleware work?" has a specific answer; recency
 *   and popularity add little signal compared to semantic match.
 * - **High minScore (0.45)** — irrelevant code context is worse than no
 *   context. It wastes the LLM's context window and can mislead the agent.
 * - **Long decay (30 days)** — code knowledge stays relevant across sprints.
 *   The architecture decision from 3 weeks ago is still valid.
 * - **No enrichment** — code is already structured and precise. LLM
 *   rewriting risks destroying syntax, variable names, and technical terms.
 * - **No query expansion** — code queries are precise enough that
 *   reformulation rarely helps and adds latency.
 * - **No graph expansion** — code memories are typically self-contained.
 *   The function implementation doesn't need links to follow.
 * - **Small topK (5)** — fewer, more precise results. Code agents have
 *   limited context window and need every token to count.
 *
 * When to use something else:
 * - If the tool also stores user preferences/feedback → use `curated-memory`
 *   for the preferences and `coding-assistant` for code context
 * - If code is stored as files rather than conversation → use `knowledge-base`
 */
export const PROFILE_CODING_ASSISTANT: Db0Profile = {
  name: "coding-assistant",
  description: "Developer tools — precise retrieval with long-lived context",
  ingest: {
    mode: "session",
    enrich: false,
  },
  retrieval: {
    topK: 5,
    minScore: 0.45,
    scoring: "hybrid",
    hybridWeights: { similarity: 0.85, recency: 0.1, popularity: 0.05 },
    decayHalfLifeDays: 30,
    queryExpansion: false,
    graphExpand: { enabled: false },
  },
  extraction: {
    strategy: "rules",
  },
  context: {
    budgetRatio: 0.1,
    includeEdges: false,
  },
};

// ─── Curated Memory ─────────────────────────────────────────────────────────

/**
 * **Curated Memory** — optimized for human-authored, long-lived memory files.
 *
 * Best for: Claude Code's `~/.claude/memory/` system, personal knowledge
 * management, user preference stores, or any application where memories
 * are explicitly written and curated rather than auto-extracted.
 *
 * This profile is specifically designed for the pattern where:
 * 1. An agent (or human) explicitly writes structured memory files
 * 2. Each file has clear metadata (frontmatter with name/type/description)
 * 3. Memories represent durable facts (preferences, feedback, project context)
 * 4. The corpus is small (tens to hundreds of files, not thousands)
 * 5. Content almost never expires — "user prefers snake_case" is valid indefinitely
 *
 * Key design decisions:
 * - **Chunk ingest without enrichment** — files are already well-structured
 *   by the human author. Enrichment would add cost without benefit since
 *   curated files don't have unresolved pronouns or vague references.
 * - **Latent Semantic Bridging enabled** — curated memory queries are often
 *   conceptual ("what does the user think about testing?") while the memory
 *   file might say "integration tests must hit a real database". A second
 *   embedding on inferred meaning bridges this gap. The corpus is small enough
 *   (tens to hundreds of files) that doubling entries has negligible cost.
 * - **Very high similarity weight (0.90)** — when searching curated memories,
 *   semantic match is almost the entire signal. The memory about "testing
 *   preferences" should rank by how well it matches the query, period.
 * - **Near-zero recency (0.05)** — a user preference saved 3 months ago is
 *   just as valid as one saved yesterday. Recency is almost irrelevant.
 * - **Very slow decay (90 days)** — even the small recency weight barely
 *   decays. A memory's recency score is still 50% after 3 months.
 * - **Manual extraction** — memories are explicitly authored, not auto-extracted.
 *   The application (Claude Code) decides when and what to remember.
 * - **No graph expansion** — curated memories are independent facts.
 *   "User is a data scientist" doesn't link to "user prefers dark mode".
 * - **No query expansion** — curated memory queries are typically precise
 *   ("what does the user prefer for testing?") and the corpus is small enough
 *   that similarity search alone has high recall.
 * - **Moderate topK (8)** — small corpus means 8 results likely covers all
 *   relevant memories. Going higher risks including noise.
 *
 * When to use something else:
 * - If memories are auto-extracted from conversation → use `conversational`
 * - If files are large documents rather than curated facts → use `knowledge-base`
 */
export const PROFILE_CURATED_MEMORY: Db0Profile = {
  name: "curated-memory",
  description: "Curated long-lived facts — high precision, near-zero decay, manual extraction",
  ingest: {
    mode: "chunk",
    chunkSize: 1200,
    chunkOverlap: 200,
    enrich: false,
    latentBridging: true,
  },
  retrieval: {
    topK: 8,
    minScore: 0.45,
    scoring: "hybrid",
    hybridWeights: { similarity: 0.9, recency: 0.05, popularity: 0.05 },
    decayHalfLifeDays: 90,
    queryExpansion: false,
    graphExpand: { enabled: false },
  },
  extraction: {
    strategy: "manual",
  },
  context: {
    budgetRatio: 0.15,
    includeEdges: false,
  },
};

// ─── High Recall ────────────────────────────────────────────────────────────

/**
 * **High Recall** — maximizes retrieval coverage at the cost of precision.
 *
 * Best for: benchmarks (LoCoMo, MR-NIAH), research assistants, legal
 * discovery, or any workload where missing a relevant memory is worse
 * than returning irrelevant ones.
 *
 * Key design decisions:
 * - **Aggressive chunking** — smaller chunks (1200 chars) with enrichment
 *   and wider context window (2 neighbors) maximize the chance that
 *   every relevant fact has its own retrievable unit.
 * - **Low minScore (0.25)** — permissive threshold lets borderline matches
 *   through. The answer generator can handle some noise; a missed fact
 *   cannot be recovered.
 * - **Large topK (15)** — cast a wide net. More results = more context
 *   for the answer generator to work with.
 * - **Query expansion enabled** — LLM reformulations catch memories that
 *   match the intent but use different terminology. Adds latency but
 *   significantly improves recall on vague or conceptual queries.
 * - **Latent Semantic Bridging** — every retrieval path is explored, including
 *   conceptual matches via metadata-embedded entries. With large topK, the
 *   deduplication overhead is minimal and the recall gain is significant.
 * - **Full graph expansion** — follow all relationship types to maximum depth.
 *
 * When to use something else:
 * - If latency matters → use `agent-context` or `conversational`
 * - If precision matters more than recall → use `coding-assistant`
 */
export const PROFILE_HIGH_RECALL: Db0Profile = {
  name: "high-recall",
  description: "Maximum retrieval coverage — low thresholds, query expansion, large top-K",
  ingest: {
    mode: "chunk",
    chunkSize: 1200,
    chunkOverlap: 200,
    enrich: true,
    enrichWindowSize: 2,
    latentBridging: true,
  },
  retrieval: {
    topK: 15,
    minScore: 0.25,
    scoring: "hybrid",
    hybridWeights: { similarity: 0.6, recency: 0.25, popularity: 0.15 },
    decayHalfLifeDays: 14,
    queryExpansion: true,
    graphExpand: { enabled: true, maxExpand: 5 },
  },
  extraction: {
    strategy: "rules",
  },
  context: {
    budgetRatio: 0.25,
    includeEdges: true,
  },
};

// ─── Minimal ────────────────────────────────────────────────────────────────

/**
 * **Minimal** — lightweight, zero-LLM profile for testing or resource-constrained
 * environments.
 *
 * Best for: unit tests, CI pipelines, local development, edge deployments,
 * or any situation where you want memory functionality without LLM costs.
 *
 * Key design decisions:
 * - **Pure similarity scoring** — no hybrid blending, just cosine similarity.
 *   Simplest possible ranking with predictable behavior.
 * - **No enrichment, no expansion** — zero LLM calls at both ingest and
 *   query time. Works with hash-based embeddings if needed.
 * - **Rules extraction** — signal-word based, no LLM calls. Catches explicit
 *   "remember this" patterns without any external API dependency.
 * - **Small topK (5)** — minimal memory usage and fast response.
 *
 * When to use something else:
 * - For any production workload → choose a workload-specific profile
 */
export const PROFILE_MINIMAL: Db0Profile = {
  name: "minimal",
  description: "Lightweight — pure similarity, no enrichment, no LLM calls",
  ingest: {
    mode: "session",
    enrich: false,
  },
  retrieval: {
    topK: 5,
    minScore: 0.4,
    scoring: "similarity",
    queryExpansion: false,
    graphExpand: { enabled: false },
  },
  extraction: {
    strategy: "rules",
  },
  context: {
    budgetRatio: 0.1,
    includeEdges: false,
  },
};

// ─── Profile Index ──────────────────────────────────────────────────────────

/** All built-in profiles indexed by name. */
export const PROFILES: Record<string, Db0Profile> = {
  "conversational": PROFILE_CONVERSATIONAL,
  "agent-context": PROFILE_AGENT_CONTEXT,
  "knowledge-base": PROFILE_KNOWLEDGE_BASE,
  "coding-assistant": PROFILE_CODING_ASSISTANT,
  "curated-memory": PROFILE_CURATED_MEMORY,
  "high-recall": PROFILE_HIGH_RECALL,
  "minimal": PROFILE_MINIMAL,
};
