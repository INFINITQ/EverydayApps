/**
 * How well `query` matches `text`: its letters must appear in order; matches at word starts
 * and runs of consecutive letters score higher. Returns -1 when it doesn't match.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();
  let score = 0;
  let from = 0;
  let previous = -2;
  for (const ch of q) {
    if (ch === ' ') continue;
    const found = t.indexOf(ch, from);
    if (found < 0) return -1;
    const wordStart = found === 0 || /[\s\-_/.]/.test(t[found - 1] ?? '');
    score += 1 + (wordStart ? 3 : 0) + (found === previous + 1 ? 2 : 0) - Math.min(found - from, 3) * 0.1;
    previous = found;
    from = found + 1;
  }
  return score - t.length * 0.01;
}

/** Items matching `query`, best first (all items, unchanged, for an empty query). */
export function fuzzyFilter<T>(items: readonly T[], query: string, text: (item: T) => string): T[] {
  if (!query.trim()) return [...items];
  return items
    .map((item) => ({ item, score: fuzzyScore(query, text(item)) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);
}
