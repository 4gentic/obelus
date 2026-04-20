// Tiny subsequence scorer: returns a score if every character of `needle`
// appears in `haystack` in order; higher is better. Matches at word starts
// score higher; adjacent matches score higher.
export function fuzzyScore(needle: string, haystack: string): number | null {
  if (needle === "") return 0;
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();
  let score = 0;
  let ni = 0;
  let prevMatch = -2;
  for (let hi = 0; hi < h.length && ni < n.length; hi++) {
    if (h[hi] === n[ni]) {
      let bonus = 1;
      if (hi === 0 || h[hi - 1] === " " || h[hi - 1] === "/") bonus += 2;
      if (hi === prevMatch + 1) bonus += 2;
      score += bonus;
      prevMatch = hi;
      ni++;
    }
  }
  return ni === n.length ? score : null;
}

export interface FuzzyHit<T> {
  item: T;
  score: number;
}

export function fuzzyFilter<T>(
  items: readonly T[],
  query: string,
  accessor: (item: T) => string,
): Array<FuzzyHit<T>> {
  if (query.trim() === "") return items.map((item) => ({ item, score: 0 }));
  const hits: Array<FuzzyHit<T>> = [];
  for (const item of items) {
    const s = fuzzyScore(query, accessor(item));
    if (s !== null) hits.push({ item, score: s });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits;
}
