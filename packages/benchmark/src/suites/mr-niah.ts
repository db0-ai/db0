import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { BenchmarkDataset, ConversationSession, BenchmarkQuery } from "../types.js";

/**
 * MR-NIAH (Multi-Round Needle in a Haystack) dataset loader.
 *
 * Source: MiniMax — https://github.com/MiniMax-AI/MiniMax-01/tree/main/evaluation/MR-NIAH
 *
 * Each sample is a multi-turn conversation with a "needle" (poem, list, passage)
 * injected at various depths. The final user message asks the model to repeat
 * the needle verbatim. Scoring checks case-sensitive key-phrase substring match.
 *
 * Dataset structure:
 *   data/<lang>/<tokens>_tokens.jsonl
 *   23 token buckets × 2 languages × 30 samples each = 1,380 total
 *   10 unique needles per language, each at 3 positions (25%, 50%, 75%)
 */

interface MrNiahSample {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  label: string;
  length_class: number;
}

export interface MrNiahLoadOptions {
  /** Path to directory containing language subdirs (english/, chinese/). */
  dataPath?: string;
  /** Languages to load. Default: ["english"] */
  languages?: Array<"english" | "chinese">;
  /** Token bucket sizes to load. Default: smallest 5 buckets. */
  tokenBuckets?: number[];
  /** Max samples per file (each file has 30). Default: all. */
  maxSamplesPerFile?: number;
}

/** All available token buckets in the MR-NIAH dataset. */
export const MR_NIAH_TOKEN_BUCKETS = [
  2048, 10240, 20480, 30720, 40960, 51200, 61440, 71680, 81920,
  92160, 102400, 112640, 122880, 131072, 204800, 307200, 409600,
  512000, 614400, 716800, 819200, 921600, 1024000,
] as const;

const DEFAULT_BUCKETS = [2048, 10240, 20480, 30720, 40960];

/**
 * Load MR-NIAH dataset from local JSONL files.
 *
 * Data layout: <dataPath>/<language>/<tokens>_tokens.jsonl
 *
 * Use fetchMrNiahData() or download manually from:
 * https://github.com/MiniMax-AI/MiniMax-01/tree/main/evaluation/MR-NIAH/data
 */
export function loadMrNiahDataset(opts: MrNiahLoadOptions = {}): BenchmarkDataset {
  const dataPath = opts.dataPath ?? "packages/benchmark/data/mr-niah";
  const languages = opts.languages ?? ["english"];
  const tokenBuckets = opts.tokenBuckets ?? DEFAULT_BUCKETS;
  const maxPerFile = opts.maxSamplesPerFile;

  const sessions: ConversationSession[] = [];
  const queries: BenchmarkQuery[] = [];
  let sampleIdx = 0;

  for (const lang of languages) {
    const langDir = join(dataPath, lang);
    if (!existsSync(langDir)) {
      throw new Error(
        `MR-NIAH data not found at ${langDir}. ` +
        `Download with: npm run bench:mr-niah-fetch, or see packages/benchmark/README.md`,
      );
    }

    for (const bucket of tokenBuckets) {
      const filePath = join(langDir, `${bucket}_tokens.jsonl`);
      if (!existsSync(filePath)) continue;

      const lines = readFileSync(filePath, "utf-8")
        .split("\n")
        .filter((l) => l.trim());

      const samples: MrNiahSample[] = [];
      for (const line of lines) {
        try {
          samples.push(JSON.parse(line));
        } catch {
          // Skip malformed/truncated lines (large files may be incomplete)
        }
      }
      const toProcess = maxPerFile ? samples.slice(0, maxPerFile) : samples;

      for (const sample of toProcess) {
        const id = `mr-niah-${lang}-${bucket}-${sampleIdx}`;

        // All messages except the last user message form the conversation
        const allMsgs = sample.messages;
        const lastMsg = allMsgs[allMsgs.length - 1];
        const conversationMsgs = allMsgs.slice(0, -1);

        // Build a single session from the conversation history
        const turns = conversationMsgs.map((m, idx) => ({
          role: m.role,
          content: m.content,
          turnIndex: idx,
        }));

        if (turns.length > 0) {
          sessions.push({
            id: `${id}-session`,
            turns,
            metadata: {
              language: lang,
              tokenBucket: bucket,
              lengthClass: sample.length_class,
            },
          });
        }

        // The last user message is the query
        queries.push({
          id,
          query: lastMsg.content,
          expectedAnswer: sample.label,
          category: formatBucketCategory(bucket),
          metadata: {
            language: lang,
            tokenBucket: bucket,
            lengthClass: sample.length_class,
            sessionId: `${id}-session`,
          },
        });

        sampleIdx++;
      }
    }
  }

  return {
    name: "mr-niah",
    description: `MR-NIAH needle-in-a-haystack (${languages.join(",")}; ${tokenBuckets.length} buckets; ${queries.length} queries)`,
    sessions,
    queries,
  };
}

function formatBucketCategory(tokens: number): string {
  if (tokens < 10000) return `${tokens}`;
  if (tokens < 1000000) return `${Math.round(tokens / 1024)}k`;
  return `${(tokens / 1024000).toFixed(1)}M`;
}

/**
 * List available token bucket files in the data directory.
 */
export function listMrNiahFiles(dataPath: string = "packages/benchmark/data/mr-niah"): {
  language: string;
  bucket: number;
  path: string;
  sampleCount: number;
}[] {
  const result: { language: string; bucket: number; path: string; sampleCount: number }[] = [];

  if (!existsSync(dataPath)) return result;

  for (const lang of readdirSync(dataPath)) {
    const langDir = join(dataPath, lang);
    try {
      for (const file of readdirSync(langDir)) {
        const match = file.match(/^(\d+)_tokens\.jsonl$/);
        if (!match) continue;
        const bucket = Number(match[1]);
        const filePath = join(langDir, file);
        const lineCount = readFileSync(filePath, "utf-8").split("\n").filter((l) => l.trim()).length;
        result.push({ language: lang, bucket, path: filePath, sampleCount: lineCount });
      }
    } catch {
      // Not a directory
    }
  }

  return result.sort((a, b) => a.bucket - b.bucket || a.language.localeCompare(b.language));
}

// === Key-phrase scoring (ported from MiniMax's score.py) ===

/**
 * Decompose a ground-truth label into key phrases for MR-NIAH scoring.
 * Mirrors MiniMax's modify_gt() function.
 */
export function decomposeLabel(label: string): string[] {
  // Known labels → hardcoded phrase decomposition (from MiniMax)
  const known = KNOWN_LABELS.get(label);
  if (known) return known;

  // Fallback: split multi-line labels into individual lines,
  // strip numbered prefixes like "1. ", "2. "
  const lines = label
    .split("\n")
    .map((l) => l.replace(/^\d+\.\s*/, "").trim())
    .filter((l) => l.length > 0);

  return lines.length > 0 ? lines : [label];
}

/**
 * Score a prediction against a ground-truth label using MR-NIAH's
 * key-phrase substring matching rubric.
 *
 * Returns 0-1 (fraction of key phrases found in the prediction).
 */
export function scoreMrNiah(prediction: string, label: string, language?: string): number {
  if (!prediction.trim()) return 0;

  // Refusal detection (mirrors MiniMax, but only for short answers to avoid
  // false positives when scoring raw retrieved content)
  const lang = language ?? detectLanguage(label);
  if (prediction.length < 500) {
    if (lang === "chinese" && (prediction.includes("抱歉") || prediction.includes("没有之前的对话"))) return 0;
    if (lang === "english" && (/\bsorry\b/i.test(prediction) || /no previous conversation/i.test(prediction))) return 0;
  }

  const phrases = decomposeLabel(label);
  if (phrases.length === 0) return 0;

  // Case-sensitive substring match (per MiniMax spec)
  const hits = phrases.map((phrase) => (prediction.includes(phrase) ? 1 : 0));
  return hits.reduce<number>((a, b) => a + b, 0) / hits.length;
}

function detectLanguage(text: string): "english" | "chinese" {
  for (const ch of text) {
    if ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z")) return "english";
  }
  return "chinese";
}

// Hardcoded key-phrase decompositions from MiniMax's official scoring script
const KNOWN_LABELS = new Map<string, string[]>([
  // English
  ["1. Piano\n2. Violin\n3. Guitar", ["Piano", "Violin", "Guitar"]],
  ["1. Vibrant\n2. Fresh\n3. Warm", ["Vibrant", "Fresh", "Warm"]],
  ["1. Calculus\n2. Linear Algebra\n3. Probability Theory", ["Calculus", "Linear Algebra", "Probability Theory"]],
  ["1. Apple\n2. Banana\n3. Orange", ["Apple", "Banana", "Orange"]],
  ["1. Han Xin\n2. Yue Fei\n3. Huo Qubing", ["Han Xin", "Yue Fei", "Huo Qubing"]],
  [
    "On the peak of the Antarctic iceberg,\nPenguins dance with tiny wings.\nWearing black and white tuxedos, stumbling steps,\nThey smile at the severe frost in the cold wind.",
    ["On the peak of the Antarctic iceberg", "Penguins dance with tiny wings", "Wearing black and white tuxedos", "stumbling steps", "They smile at the severe frost in the cold wind"],
  ],
  [
    "Red as fire, delicate and dripping,\nPetals layered, fragrance overflowing.",
    ["Red as fire", "delicate and dripping", "Petals layered", "fragrance overflowing"],
  ],
  [
    "Cicadas chirping, the sounds rise and fall.\nUnder the shade, elders leisurely play chess.\nChildren play, laughter fills the park.",
    ["Cicadas chirping, the sounds rise and fall", "Under the shade, elders leisurely play chess", "Children play, laughter fills the park"],
  ],
  [
    "Vast and blue, waves surging, cradle of life.",
    ["Vast and blue", "waves surging", "cradle of life"],
  ],
  [
    "Small in size, gray-brown feathers,\nLikes to forage in the city, chirping lively.",
    ["Small in size", "gray-brown feathers", "Likes to forage in the city", "chirping lively"],
  ],
  // Chinese
  ["1. 钢琴\n2. 小提琴\n3. 吉他", ["钢琴", "小提琴", "吉他"]],
  ["1. 生机勃勃\n2. 春暖花开\n3. 万物复苏", ["生机勃勃", "春暖花开", "万物复苏"]],
  ["1. 微积分\n2. 线性代数\n3. 概率论", ["微积分", "线性代数", "概率论"]],
  ["1. 苹果\n2. 香蕉\n3. 橙子", ["苹果", "香蕉", "橙子"]],
  ["1. 韩信\n2. 岳飞\n3. 霍去病", ["韩信", "岳飞", "霍去病"]],
  [
    "在南极的冰山之巅，\n企鹅们舞动着短小的翅膀。\n身披黑白礼服，步伐蹒跚，\n在寒风中，它们笑对严霜。",
    ["在南极的冰山之巅", "企鹅们舞动着短小的翅膀", "身披黑白礼服", "步伐蹒跚", "在寒风中", "它们笑对严霜"],
  ],
  [
    "红艳如火，娇嫩欲滴，\n花瓣层叠，芳香四溢。",
    ["红艳如火", "娇嫩欲滴", "花瓣层叠", "芳香四溢"],
  ],
  [
    "蝉鸣阵阵，知了此起彼伏。\n树荫下，老人们悠闲地下着棋。\n孩童嬉戏，欢笑声传遍公园。",
    ["蝉鸣阵阵，知了此起彼伏", "树荫下，老人们悠闲地下着棋", "孩童嬉戏，欢笑声传遍公园"],
  ],
  [
    "蔚蓝无垠，波涛汹涌，生命的摇篮。",
    ["蔚蓝无垠", "波涛汹涌", "生命的摇篮"],
  ],
  [
    "体型小巧，羽毛灰褐，\n喜欢在城市中觅食，叽叽喳喳很热闹。",
    ["体型小巧", "羽毛灰褐", "喜欢在城市中觅食", "叽叽喳喳很热闹"],
  ],
]);
