# @db0-ai/benchmark

Memory quality benchmarks for db0. Evaluates retrieval accuracy, answer generation, and end-to-end memory system performance using standard datasets.

## Quick Start

```bash
# Simple recall + feature tests (no API key needed)
npm run bench

# LoCoMo benchmark (requires Gemini API key)
GEMINI_API_KEY=your-key npm run bench:locomo -- --embeddings gemini --samples 1 --queries 200 --ingest session

# MR-NIAH benchmark (requires data download + Gemini API key)
npm run bench:mr-niah-fetch
GEMINI_API_KEY=your-key npm run bench:mr-niah -- --embeddings gemini
```

## Benchmark Suites

### Recall

15-query dataset testing basic memory retrieval: single-hop fact recall, temporal reasoning, multi-hop inference, and unanswerable detection.

```bash
npm run bench:recall
```

### Features

db0-specific functional tests: memory superseding, scope isolation, relationship edges, noise filtering, and state branching.

```bash
npm run bench:features
```

### LoCoMo

[LoCoMo](https://github.com/snap-research/locomo) (Long-term Conversational Memory) from Snap Research. 10 conversation samples with ~1986 QA pairs across 5 categories:

| Category | Count | Description |
|---|---|---|
| Single-hop | 282 | Direct fact recall from one turn |
| Multi-hop temporal | 321 | Facts requiring date computation |
| Open-domain | 96 | Inference beyond explicit statements |
| Multi-session | 841 | Facts spread across sessions |
| Unanswerable | 446 | Entity-swap traps with no evidence |

```bash
GEMINI_API_KEY=your-key npm run bench:locomo -- --embeddings gemini
```

### MR-NIAH

[MR-NIAH](https://github.com/MiniMax-AI/MiniMax-01/tree/main/evaluation/MR-NIAH) (Multi-Round Needle in a Haystack) from MiniMax. Tests verbatim recall of specific content ("needles") buried in long multi-turn conversations.

- 23 token buckets (2K–1M tokens) × 2 languages × 30 samples = 1,380 total
- 10 unique needles per language (poems, lists, passages)
- Each needle placed at 3 depths (25%, 50%, 75% of conversation)
- Deterministic scoring: case-sensitive key-phrase substring match

```bash
# Download data first (English, 5 smallest buckets by default)
npm run bench:mr-niah-fetch

# Run benchmark
GEMINI_API_KEY=your-key npm run bench:mr-niah -- --embeddings gemini

# Full dataset (all buckets, both languages)
bash scripts/fetch-mr-niah.sh --all
GEMINI_API_KEY=your-key npm run bench:mr-niah -- --embeddings gemini --lang english,chinese --buckets 2048,10240,20480,30720,40960,51200
```

### LongMemEval-s

[LongMemEval](https://arxiv.org/abs/2410.10813) (Wu et al., 2025) — the successor to LoCoMo, designed as a harder benchmark for conversational memory systems. Uses the [cleaned variant](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned) (MIT license).

- 500 questions across 6 categories testing 5 core memory abilities
- ~115k tokens per question (~48 sessions)
- Per-question haystack (each question has its own set of sessions)

| Category | Count | Description | db0 feature tested |
|---|---|---|---|
| single-session-user | 70 | Extraction from user messages | Chunk retrieval |
| single-session-assistant | 56 | Extraction from assistant responses | Chunk retrieval |
| single-session-preference | 30 | User preference inference | Scoped memory |
| multi-session | 133 | Cross-session reasoning | Multi-session search |
| temporal-reasoning | 133 | Time-based comprehension | Temporal metadata |
| knowledge-update | 78 | Tracking changed facts | Superseding |

```bash
# Download data first
bash packages/benchmark/scripts/fetch-longmemeval.sh

# Run benchmark (conversational profile is the default)
GEMINI_API_KEY=your-key npm run bench:longmemeval -- --embeddings gemini

# Limit questions for faster iteration
GEMINI_API_KEY=your-key npm run bench:longmemeval -- --embeddings gemini --queries 50

# Use a different profile
GEMINI_API_KEY=your-key npm run bench:longmemeval -- --embeddings gemini --profile high-recall

# Filter by category
GEMINI_API_KEY=your-key npm run bench:longmemeval -- --embeddings gemini --types knowledge-update,temporal-reasoning
```

Published scores for competitive positioning:

| System | LongMemEval-s Score |
|---|---|
| Observational Memory (GPT-5-mini) | 94.9% |
| Hindsight (Gemini-3 Pro) | 91.4% |
| Emergence RAG | 86% |
| Supermemory | 85.2% |
| Oracle GPT-4o (perfect retrieval) | 82.4% |
| TiMem | 76.9% |
| Zep | 71.2% |
| Full Context GPT-4o | 63.8% |
| Mem0 | 29% |

## CLI Options

### Common

| Flag | Description | Default |
|---|---|---|
| `--suite` | `all`, `recall`, `features`, `locomo`, `longmemeval`, `mr-niah` | `all` |
| `--embeddings` | `hash`, `gemini`, `openai` | `hash` |
| `--ingest` | Ingestion mode (see below) | varies by suite |
| `--rerank` | Enable Gemini LLM reranking | disabled |
| `--enrich` | Enable Sliding Window Chunk Enrichment (LLM resolves pronouns/references) | disabled |
| `--enrich-mode` | Enrichment mode: `augment` (metadata header) or `rewrite` (full rewrite) | `augment` |
| `--expand` | Enable Adaptive Query Expansion (LLM generates diverse reformulations, merged via RRF) | disabled |
| `--latent-bridging` | Enable Latent Semantic Bridging (second embedding on inferred meaning, deduplicated) | disabled |
| `--json` | Output JSON report | disabled |

### LoCoMo-specific

| Flag | Description | Default |
|---|---|---|
| `--samples` | LoCoMo samples to load (1-10) | `1` |
| `--queries` | Max queries per sample | `50` |

### LongMemEval-specific

| Flag | Description | Default |
|---|---|---|
| `--queries` | Max questions to evaluate | `500` (all) |
| `--profile` | db0 profile name (`conversational`, `high-recall`, etc.) | `conversational` |
| `--types` | Comma-separated question types to filter | all |

### MR-NIAH-specific

| Flag | Description | Default |
|---|---|---|
| `--lang` | Languages: `english`, `chinese`, or both | `english` |
| `--buckets` | Comma-separated token bucket sizes | 5 smallest |
| `--samples` | Max samples per file (each file has ~30) | all |

## Ingestion Modes

| Mode | Description | Best For |
|---|---|---|
| `turn` | Each conversation turn as a separate memory | Fine-grained retrieval |
| `session` | Entire session as one memory | Large-context LLM reasoning |
| `chunk` | Session split into overlapping windows | Balanced retrieval + context |
| `extract` | Rules-based fact extraction + chunks | Structured fact recall |
| `llm-extract` | LLM-based fact extraction + chunks | High-precision extraction |
| `turn-context` | Each turn with surrounding context window | QA benchmarks |
| `dual` | Sessions + individual turns | Broad + precise matching |

## Metrics

| Metric | Description |
|---|---|
| `llm_judge` | LLM (Gemini) scores answer correctness (binary 0/1). Headline metric from BRV-Bench |
| `mr_niah_score` | Key-phrase substring match (MiniMax rubric). Fraction of ground-truth phrases found in answer |
| `token_f1` | Token-level F1 between generated and expected answer (SQuAD-style) |
| `retrieval_coverage` | Whether expected answer text appears in any retrieved result |
| `hit_rate@K` | Binary — is the expected answer in top-K results? |

## Results

Best configurations with Gemini embeddings (1 sample, 199 queries):

### By Ingestion Mode

| Configuration | LLM Judge | Notes |
|---|---|---|
| **session** | **76.9%** | Best overall — full conversational context |
| chunk + augment enrich | 69.3% | Best chunk mode (+11.5pp over baseline) |
| chunk baseline | 57.8% | No enrichment |
| chunk + rewrite enrich | 28.1% | Semantic drift — avoid for conversations |

### Retrieval Enhancement Features (chunk mode)

| Feature | LLM Judge | Delta | Verdict |
|---|---|---|---|
| Baseline (chunk) | 57.8% | — | — |
| + Augment enrichment | 69.3% | +11.5pp | Significant improvement |
| + Query expansion | 58.3% | +0.5pp | Neutral alone |
| + Latent bridging (no dedup) | 59.3% | -10.0pp from augment | Top-K dilution |
| + Latent bridging (with dedup) | 58.8% | -10.5pp from augment | Metadata too generic for conversations |
| + Rewrite enrichment | 28.1% | -29.7pp | Semantic drift |

### Category Breakdown (session mode, best)

| Category | LLM Judge |
|---|---|
| Multi-hop temporal | 81.1% |
| Multi-session | 81.4% |
| Unanswerable | 87.2% |
| Open-domain | 69.2% |
| Single-hop | 50.0% |

### Comparison with BRV-Bench Leaderboard

| System | LoCoMo LLM Judge |
|---|---|
| ByteRover | 92.2% |
| **db0 (session)** | **76.9%** |
| **db0 (chunk+augment)** | **69.3%** |
| Mem0 | 66.9% |
| Zep | 21.3% |
| Memoripy | 12.4% |

### Key Findings

- **Augment enrichment** is the biggest single improvement for chunk mode. It resolves temporal references that chunks lose, boosting multi-hop-temporal from 5.4% to 56.8%.
- **Rewrite enrichment** destroys conversational context (speaker attribution, nuance). Only suitable for structured documents.
- **Latent Semantic Bridging** hurts conversational workloads even with deduplication — inferred metadata is too generic (multiple conversation chunks share similar topics). Expected to help on knowledge-base and curated-memory workloads where chunks are more semantically distinct.
- **Query expansion** is neutral on LoCoMo but may help on knowledge-base workloads with open-ended queries.

### LongMemEval-s Results

**Baseline: `conversational` profile, session ingest, OpenAI embeddings (`text-embedding-3-small`) + OpenAI LLM (`gpt-4.1-mini`):**

| Category | n | LLM Judge | Coverage | Hit@5 |
|---|---|---|---|---|
| single-session-assistant | 56 | **98.2%** | 55.4% | 55.4% |
| knowledge-update | 78 | **64.1%** | 60.3% | 60.3% |
| temporal-reasoning | 133 | 57.1% | 24.8% | 24.8% |
| single-session-user | 70 | 57.1% | 44.3% | 44.3% |
| multi-session | 62 | 45.2% | 43.5% | 43.5% |
| single-session-preference | 18 | 22.2% | 0.0% | 0.0% |
| **Weighted avg** | **417** | **~57%** | | |

For context, published scores: Zep 71.2%, Full Context GPT-4o 63.8%, Mem0 29%.

Key observations:
- **Single-session-assistant is near-perfect** (98.2%) — session-level ingest preserves full conversational context; assistant messages are easy to retrieve and extract from.
- **Knowledge-update is solid** (64.1%, 60.3% coverage) — superseding primitive should push this higher with profile-aware retrieval.
- **Temporal reasoning is the weak spot** (57.1% judge but only 24.8% coverage) — high judge score despite low coverage suggests the LLM is sometimes reasoning correctly without retrieved evidence. Chunk mode with date metadata should help coverage.
- **Single-session-user (57.1%)** — coverage only 44.3%; `minScore: 0.4` may be too aggressive with OpenAI embeddings.
- **Multi-session (45.2%)** — reasonable coverage (43.5%) but answer synthesis across sessions is hard.
- **Preferences are implicit** (22.2%, 0% coverage) — requires inference beyond literal retrieval. An LLM extraction step would help.

Improvement opportunities:
1. **Lower minScore threshold** — try `high-recall` profile (`minScore: 0.25`, `topK: 15`) to cast a wider net.
2. **Chunk mode with date metadata** — should help temporal reasoning by adding explicit dates to chunks.
3. **Augment enrichment** — helped LoCoMo +11.5pp; should help here too by resolving pronouns and temporal references.
4. **LLM extraction** — would help preference questions by extracting implicit preferences as explicit facts.

## Architecture

```
┌──────────────────────────────────────────┐
│              Benchmark CLI               │
│  --suite locomo|longmemeval|mr-niah ...  │
└─────────────────┬────────────────────────┘
                  │
┌─────────────────▼────────────────────────┐
│            Runner Pipeline               │
│  setup → ingest → query → score → report │
└────┬────────┬──────────────┬─────────────┘
     │        │              │
┌────▼───┐ ┌──▼──────┐ ┌────▼──────┐
│Adapter │ │ Metrics  │ │ Reporter  │
│(db0)   │ │(LLM     │ │(console,  │
│        │ │ judge,  │ │ JSON)     │
│ingest  │ │ F1,     │ │           │
│modes,  │ │ hit@K)  │ │           │
│rerank  │ │         │ │           │
└────────┘ └─────────┘ └───────────┘
```

## Programmatic Usage

```typescript
import { runBenchmark, Db0Adapter, LlmJudgeMetric, TokenF1Metric, loadLoCoMoDataset } from "@db0-ai/benchmark";
import { createSqliteBackend } from "@db0-ai/backends-sqlite";

const adapter = new Db0Adapter({
  createBackend: () => createSqliteBackend({ dbPath: ":memory:" }),
  embeddingFn: yourEmbeddingFn,
  scoring: "hybrid",
  ingestMode: "session",
});

const report = await runBenchmark({
  adapter,
  dataset: loadLoCoMoDataset({ maxSamples: 1 }),
  metrics: [new LlmJudgeMetric({ judgeFn: yourJudgeFn }), new TokenF1Metric()],
  queryLimit: 20,
});

console.log(report.overall); // { llm_judge: 0.769, token_f1: 0.208 }
```

### MR-NIAH

```typescript
import { runBenchmark, Db0Adapter, MrNiahScoreMetric, TokenF1Metric, loadMrNiahDataset } from "@db0-ai/benchmark";
import { createSqliteBackend } from "@db0-ai/backends-sqlite";

const adapter = new Db0Adapter({
  createBackend: () => createSqliteBackend({ dbPath: ":memory:" }),
  embeddingFn: yourEmbeddingFn,
  scoring: "hybrid",
  ingestMode: "turn",
});

const report = await runBenchmark({
  adapter,
  dataset: loadMrNiahDataset({
    languages: ["english"],
    tokenBuckets: [2048, 10240],
    maxSamplesPerFile: 10,
  }),
  metrics: [new MrNiahScoreMetric(), new TokenF1Metric()],
  queryLimit: 15,
});

console.log(report.overall); // { mr_niah_score: ..., token_f1: ... }
// Categories break down by token bucket (2, 10k, 20k, etc.)
```

## License

MIT
