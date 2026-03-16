/**
 * Built-in hash-based embedding function.
 *
 * Generates a deterministic pseudo-embedding from text using character n-gram
 * hashing. Zero dependencies, zero API calls, instant.
 *
 * NOT a semantic embedding — similar words won't necessarily produce similar
 * vectors. But it's good enough for exact and near-exact recall, and it lets
 * you start using db0 with zero configuration.
 *
 * For real semantic search, provide your own embeddingFn (OpenAI, Ollama,
 * transformers.js, etc.).
 */

const DEFAULT_DIMENSIONS = 384;

export function hashEmbed(text: string, dimensions = DEFAULT_DIMENSIONS): Float32Array {
  const vec = new Float32Array(dimensions);
  const normalized = text.toLowerCase().trim();

  // Character trigram hashing
  for (let i = 0; i < normalized.length - 2; i++) {
    const trigram = normalized.substring(i, i + 3);
    const hash = trigramHash(trigram);
    const idx = Math.abs(hash) % dimensions;
    // Use sign of secondary hash for direction (+/-)
    vec[idx] += (hash & 1) === 0 ? 1 : -1;
  }

  // Word unigram hashing (boosts exact word overlap)
  const words = normalized.split(/\s+/);
  for (const word of words) {
    if (word.length === 0) continue;
    const hash = wordHash(word);
    const idx = Math.abs(hash) % dimensions;
    vec[idx] += (hash & 1) === 0 ? 2 : -2;
  }

  // L2 normalize
  let mag = 0;
  for (let i = 0; i < dimensions; i++) {
    mag += vec[i] * vec[i];
  }
  mag = Math.sqrt(mag);
  if (mag > 0) {
    for (let i = 0; i < dimensions; i++) {
      vec[i] /= mag;
    }
  }

  return vec;
}

function trigramHash(s: string): number {
  let h = 0x811c9dc5; // FNV-1a offset basis
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime
  }
  return h;
}

function wordHash(s: string): number {
  let h = 0x61C88647; // different seed
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x5bd1e995); // MurmurHash2 constant
  }
  return h;
}

/**
 * Async wrapper matching the embeddingFn signature.
 */
export async function defaultEmbeddingFn(text: string): Promise<Float32Array> {
  return hashEmbed(text);
}
