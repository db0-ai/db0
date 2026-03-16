import { readFileSync } from "node:fs";
import type { BenchmarkDataset, ConversationSession, BenchmarkQuery } from "../types.js";

/**
 * LoCoMo (Long-term Conversational Memory) dataset loader.
 *
 * Source: Snap Research — https://github.com/snap-research/locomo
 * 10 samples, ~1986 QAs across 5 categories:
 *   1: Single-hop (282) — direct fact recall from one turn
 *   2: Multi-hop temporal (321) — facts requiring time reasoning
 *   3: Open-domain (96) — inference/reasoning beyond explicit statements
 *   4: Multi-session (841) — facts spread across multiple sessions
 *   5: Unanswerable (446) — no evidence in conversation
 */

interface LoCoMoTurn {
  speaker: string;
  dia_id: string;
  text?: string;
  img_url?: string[];
  blip_caption?: string;
  query?: string;
}

interface LoCoMoQA {
  question: string;
  answer: string;
  evidence: string[];
  category: number;
}

interface LoCoMoSample {
  sample_id: string;
  conversation: Record<string, unknown>;
  qa: LoCoMoQA[];
}

const CATEGORY_NAMES: Record<number, string> = {
  1: "single-hop",
  2: "multi-hop-temporal",
  3: "open-domain",
  4: "multi-session",
  5: "unanswerable",
};

export interface LoCoMoLoadOptions {
  /** Path to locomo10.json. Default: packages/benchmark/data/locomo10.json */
  dataPath?: string;
  /** Limit number of samples (conversations) to load. Default: all (10). */
  maxSamples?: number;
  /** Limit QAs per sample. Default: all. */
  maxQueriesPerSample?: number;
  /** Filter by category numbers (1-5). Default: all. */
  categories?: number[];
}

export function loadLoCoMoDataset(opts: LoCoMoLoadOptions = {}): BenchmarkDataset {
  const dataPath = opts.dataPath ?? "packages/benchmark/data/locomo10.json";
  const raw: LoCoMoSample[] = JSON.parse(readFileSync(dataPath, "utf-8"));

  const maxSamples = opts.maxSamples ?? raw.length;
  const samples = raw.slice(0, maxSamples);

  const sessions: ConversationSession[] = [];
  const queries: BenchmarkQuery[] = [];

  for (const sample of samples) {
    const conv = sample.conversation;
    const speakerA = conv.speaker_a as string;
    const speakerB = conv.speaker_b as string;

    // Extract sessions
    for (let i = 1; i <= 35; i++) {
      const sessionKey = `session_${i}`;
      const dateKey = `session_${i}_date_time`;
      const sessionData = conv[sessionKey] as LoCoMoTurn[] | undefined;
      const dateTime = conv[dateKey] as string | undefined;

      if (!sessionData || !Array.isArray(sessionData)) continue;

      const turns = sessionData
        .filter((t) => t.text && t.text.trim())
        .map((t, idx) => ({
          role: (t.speaker === speakerA ? "user" : "assistant") as "user" | "assistant",
          content: t.text!,
          turnIndex: idx,
          speaker: t.speaker,
          timestamp: dateTime,
        }));

      if (turns.length > 0) {
        sessions.push({
          id: `${sample.sample_id}-${sessionKey}`,
          turns,
          metadata: { sampleId: sample.sample_id, sessionIndex: i, dateTime },
        });
      }
    }

    // Extract QAs
    let sampleQAs = sample.qa;
    if (opts.categories) {
      sampleQAs = sampleQAs.filter((q) => opts.categories!.includes(q.category));
    }
    if (opts.maxQueriesPerSample) {
      sampleQAs = sampleQAs.slice(0, opts.maxQueriesPerSample);
    }

    for (let i = 0; i < sampleQAs.length; i++) {
      const qa = sampleQAs[i];
      queries.push({
        id: `${sample.sample_id}-q${i}`,
        query: qa.question,
        expectedAnswer: qa.answer != null ? String(qa.answer) : "",
        relevantIds: qa.evidence, // dia_ids like "D1:3"
        category: CATEGORY_NAMES[qa.category] ?? `cat-${qa.category}`,
        metadata: { sampleId: sample.sample_id, originalCategory: qa.category },
      });
    }
  }

  return {
    name: "locomo",
    description: `LoCoMo long-term conversational memory (${samples.length} samples, ${queries.length} queries)`,
    sessions,
    queries,
  };
}
