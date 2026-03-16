import { readFileSync } from "node:fs";
import type { BenchmarkDataset, BenchmarkQuery, ConversationSession } from "../types.js";

/**
 * LongMemEval-s (cleaned) dataset loader.
 *
 * Source: Wu et al., 2025 — https://arxiv.org/abs/2410.10813
 * Dataset: https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned
 *
 * 500 questions across 6 categories testing 5 core memory abilities:
 *   - single-session-user (70)      — extraction from user messages
 *   - single-session-assistant (56) — extraction from assistant responses
 *   - single-session-preference (30) — user preference inference
 *   - multi-session (133)           — cross-session reasoning
 *   - temporal-reasoning (133)      — time-based comprehension
 *   - knowledge-update (78)         — tracking changed facts over time
 *
 * Each question has its own haystack of ~48 sessions (~115k tokens).
 * This differs from LoCoMo where many questions share one conversation.
 */

interface LongMemEvalTurn {
  role: "user" | "assistant";
  content: string;
}

interface LongMemEvalSample {
  question_id: string;
  question_type: string;
  question: string;
  question_date: string;
  answer: string | number;
  answer_session_ids: string[];
  haystack_dates: string[];
  haystack_session_ids: string[];
  haystack_sessions: LongMemEvalTurn[][];
}

/** A single LongMemEval question with its own haystack. */
export interface LongMemEvalQuestion {
  /** The query to evaluate. */
  query: BenchmarkQuery;
  /** Sessions to ingest (this question's haystack). */
  sessions: ConversationSession[];
}

export interface LongMemEvalLoadOptions {
  /** Path to longmemeval_s.json. Default: packages/benchmark/data/longmemeval/longmemeval_s.json */
  dataPath?: string;
  /** Limit number of questions. Default: all (500). */
  maxQuestions?: number;
  /** Filter by question types. Default: all. */
  types?: string[];
}

/**
 * Load LongMemEval-s as per-question datasets.
 *
 * Unlike LoCoMo, each question has its own haystack of sessions.
 * Returns an array of questions, each with their own sessions to ingest.
 */
export function loadLongMemEval(opts: LongMemEvalLoadOptions = {}): LongMemEvalQuestion[] {
  const dataPath = opts.dataPath ?? "packages/benchmark/data/longmemeval/longmemeval_s.json";
  const raw: LongMemEvalSample[] = JSON.parse(readFileSync(dataPath, "utf-8"));

  let samples = raw;
  if (opts.types) {
    samples = samples.filter((s) => opts.types!.includes(s.question_type));
  }
  if (opts.maxQuestions) {
    samples = samples.slice(0, opts.maxQuestions);
  }

  return samples.map((sample) => {
    const sessions: ConversationSession[] = sample.haystack_sessions.map((turns, i) => ({
      id: sample.haystack_session_ids[i],
      turns: turns.map((t, ti) => ({
        role: t.role,
        content: t.content,
        turnIndex: ti,
        timestamp: sample.haystack_dates[i],
      })),
      metadata: {
        questionId: sample.question_id,
        sessionId: sample.haystack_session_ids[i],
        dateTime: sample.haystack_dates[i],
      },
    }));

    const query: BenchmarkQuery = {
      id: sample.question_id,
      query: sample.question,
      expectedAnswer: String(sample.answer),
      relevantIds: sample.answer_session_ids,
      category: sample.question_type,
      metadata: {
        questionDate: sample.question_date,
        answerSessionIds: sample.answer_session_ids,
      },
    };

    return { query, sessions };
  });
}

/** Category display names for reporting. */
export const LONGMEMEVAL_CATEGORIES = [
  "single-session-user",
  "single-session-assistant",
  "single-session-preference",
  "multi-session",
  "temporal-reasoning",
  "knowledge-update",
] as const;

/**
 * Convert LongMemEval questions to a flat BenchmarkDataset (for compatibility).
 * Warning: this merges all haystacks — only useful for counting/reporting,
 * NOT for running the benchmark (use loadLongMemEval + per-question runner).
 */
export function longMemEvalToDataset(questions: LongMemEvalQuestion[]): BenchmarkDataset {
  return {
    name: "longmemeval-s",
    description: `LongMemEval-s (${questions.length} questions, ${questions.reduce((s, q) => s + q.sessions.length, 0)} total sessions)`,
    sessions: [], // Not used — per-question ingest
    queries: questions.map((q) => q.query),
  };
}
