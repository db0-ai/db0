/**
 * Reciprocal Rank Fusion — merge multiple ranked result lists into one.
 *
 * RRF_score(d) = sum( 1 / (k + rank_i(d)) ) for each ranking
 *
 * @param rankedLists - Array of ranked result lists. Each list is sorted best-first.
 * @param getId - Function to extract a unique ID from each item.
 * @param k - Constant (default 60, per the original RRF paper).
 * @returns Map of id → RRF score, sorted descending.
 */
export function rrfMerge<T>(
  rankedLists: T[][],
  getId: (item: T) => string,
  k = 60,
): Map<string, number> {
  const scores = new Map<string, number>();

  for (const list of rankedLists) {
    for (let rank = 0; rank < list.length; rank++) {
      const id = getId(list[rank]);
      const current = scores.get(id) ?? 0;
      scores.set(id, current + 1 / (k + rank + 1)); // rank is 0-based, formula uses 1-based
    }
  }

  return new Map(
    [...scores.entries()].sort((a, b) => b[1] - a[1]),
  );
}

/**
 * Simple full-text relevance score.
 * Counts how many query terms appear in the text (case-insensitive).
 * Returns a normalized score between 0 and 1.
 */
export function ftsScore(text: string, queryText: string): number {
  const terms = queryText
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);
  if (terms.length === 0) return 0;

  const lower = text.toLowerCase();
  let matched = 0;
  for (const term of terms) {
    if (lower.includes(term)) matched++;
  }

  return matched / terms.length;
}
