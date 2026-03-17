# @db0-ai/benchmark

Memory quality benchmarks for db0. Measures retrieval accuracy, answer generation, and end-to-end memory system performance using published academic datasets.

## Quick Start

```bash
# Recall + feature tests (no API key needed)
npm run bench

# LoCoMo benchmark (requires Gemini API key)
GEMINI_API_KEY=your-key npm run bench:locomo -- --embeddings gemini --samples 1 --queries 200

# LongMemEval benchmark (requires data download + API key)
bash packages/benchmark/scripts/fetch-longmemeval.sh
GEMINI_API_KEY=your-key npm run bench:longmemeval -- --embeddings gemini
```

## Suites

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

### LongMemEval-s

[LongMemEval](https://arxiv.org/abs/2410.10813) (Wu et al., 2025) — a harder benchmark for conversational memory systems. Uses the [cleaned variant](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned) (MIT license).

- 500 questions across 6 categories testing 5 core memory abilities
- ~115k tokens per question (~48 sessions)

| Category | Count | db0 feature tested |
|---|---|---|
| single-session-user | 70 | Chunk retrieval |
| single-session-assistant | 56 | Chunk retrieval |
| single-session-preference | 30 | Scoped memory |
| multi-session | 133 | Multi-session search |
| temporal-reasoning | 133 | Temporal metadata |
| knowledge-update | 78 | Superseding |

```bash
bash packages/benchmark/scripts/fetch-longmemeval.sh
GEMINI_API_KEY=your-key npm run bench:longmemeval -- --embeddings gemini

# Limit questions or filter by category
GEMINI_API_KEY=your-key npm run bench:longmemeval -- --embeddings gemini --queries 50
GEMINI_API_KEY=your-key npm run bench:longmemeval -- --embeddings gemini --types knowledge-update,temporal-reasoning
```

## CLI Options

| Flag | Description | Default |
|---|---|---|
| `--suite` | `all`, `recall`, `features`, `locomo`, `longmemeval` | `all` |
| `--embeddings` | `hash`, `gemini`, `openai` | `hash` |
| `--ingest` | Ingestion mode (see below) | varies by suite |
| `--profile` | db0 profile name | `conversational` |
| `--rerank` | Enable Gemini LLM reranking | disabled |
| `--enrich` | Enable chunk enrichment (LLM resolves pronouns/references) | disabled |
| `--enrich-mode` | `augment` (metadata header) or `rewrite` (full rewrite) | `augment` |
| `--expand` | Enable query expansion (LLM generates reformulations, merged via RRF) | disabled |
| `--latent-bridging` | Enable latent semantic bridging (second embedding on inferred meaning) | disabled |
| `--json` | Output JSON report | disabled |

## Ingestion Modes

| Mode | Description | Best for |
|---|---|---|
| `turn` | Each conversation turn as a separate memory | Fine-grained retrieval |
| `session` | Entire session as one memory | Large-context reasoning |
| `chunk` | Session split into overlapping windows | Balanced retrieval + context |
| `extract` | Rules-based fact extraction + chunks | Structured fact recall |
| `llm-extract` | LLM-based fact extraction + chunks | High-precision extraction |
| `turn-context` | Each turn with surrounding context window | QA benchmarks |
| `dual` | Sessions + individual turns | Broad + precise matching |

## Metrics

| Metric | Description |
|---|---|
| `llm_judge` | LLM scores answer correctness (binary 0/1) |
| `token_f1` | Token-level F1 between generated and expected answer |
| `retrieval_coverage` | Whether expected answer text appears in any retrieved result |
| `hit_rate@K` | Binary — is the expected answer in top-K results? |

## Results

### LoCoMo (Gemini embeddings, 1 sample, 199 queries)

| Configuration | LLM Judge |
|---|---|
| **session** | **76.9%** |
| chunk + augment enrich | 69.3% |
| chunk baseline | 57.8% |

**vs. published benchmarks:**

| System | LLM Judge |
|---|---|
| ByteRover | 92.2% |
| **db0 (session)** | **76.9%** |
| Mem0 | 66.9% |
| Zep | 21.3% |

### LongMemEval-s (OpenAI embeddings, conversational profile)

| Category | n | LLM Judge | Coverage |
|---|---|---|---|
| single-session-assistant | 56 | **98.2%** | 55.4% |
| knowledge-update | 78 | **64.1%** | 60.3% |
| temporal-reasoning | 133 | 57.1% | 24.8% |
| single-session-user | 70 | 57.1% | 44.3% |
| multi-session | 62 | 45.2% | 43.5% |

**vs. published benchmarks:** Zep 71.2%, Full Context GPT-4o 63.8%, Mem0 29%.

### Key Findings

- **Augment enrichment** is the biggest single improvement for chunk mode (+11.5pp), resolving temporal references that chunks lose.
- **Rewrite enrichment** destroys conversational context — avoid for chat workloads.
- **Session mode** outperforms chunk mode on LoCoMo — full conversational context matters more than granular retrieval for this dataset.

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

console.log(report.overall);
```

## License

MIT
