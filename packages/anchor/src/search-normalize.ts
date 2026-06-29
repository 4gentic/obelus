// Normalization for in-document find. Find historically matched raw text with
// `indexOf`, so a query typed in ASCII missed the typographic forms a typeset
// paper actually contains: ligatures (U+FB01 -> "fi"), full-width and
// mathematical alphanumerics, smart quotes/dashes, non-breaking / thin spaces,
// soft hyphens, and decomposed diacritics. Selections already tolerate these
// via `normalizeQuote` (NFKC + whitespace-collapse); this is the find-side
// equivalent, but it also returns an offset map so a match found in the
// normalized text can be projected back onto the original characters the
// highlight rects/Ranges anchor to.
//
// `map` has length `text.length + 1`: `map[i]` is the UTF-16 index in `input`
// where normalized unit `i` originated, and `map[text.length] === input.length`.
// A normalized hit `[h, h+L)` recovers the original span as `[map[h], map[h+L])`.
// One source char may fold to several output units (ligature, ellipsis) — each
// maps back to that char's start; a run of whitespace collapses to one space
// mapped to the run's first char. Both are exact under the half-open
// `[h, h+L)` -> `[map[h], map[h+L])` projection.

// Code points are dropped entirely (no output): soft hyphen and the
// zero-width formatting characters.
const ZERO_WIDTH: ReadonlySet<number> = new Set([
  0x00ad, // soft hyphen
  0x200b, // zero-width space
  0x200c, // zero-width non-joiner
  0x200d, // zero-width joiner
  0x2060, // word joiner
  0xfeff, // zero-width no-break space / BOM
]);

const SINGLE_QUOTE: ReadonlySet<number> = new Set([0x2018, 0x2019, 0x201a, 0x201b]);
const DOUBLE_QUOTE: ReadonlySet<number> = new Set([0x201c, 0x201d, 0x201e, 0x201f]);
const DASH: ReadonlySet<number> = new Set([0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212]);

function fold(ch: string): string {
  const cp = ch.codePointAt(0) ?? 0;
  if (SINGLE_QUOTE.has(cp)) return "'";
  if (DOUBLE_QUOTE.has(cp)) return '"';
  if (DASH.has(cp)) return "-";
  return ch;
}

// Combining marks live at U+0300 and above; the < 0x300 guard keeps the
// Unicode-property regex off the hot path for ASCII-heavy paper text.
function isMark(cp: number): boolean {
  return cp >= 0x300 && /\p{M}/u.test(String.fromCodePoint(cp));
}

export function normalizeForSearch(input: string): { text: string; map: Int32Array } {
  const out: string[] = [];
  const map: number[] = [];
  let inSpaceRun = false;

  const emit = (s: string, src: number): void => {
    if (/\s/.test(s)) {
      if (inSpaceRun) return;
      inSpaceRun = true;
      out.push(" ");
      map.push(src);
      return;
    }
    inSpaceRun = false;
    for (let k = 0; k < s.length; k += 1) {
      out.push(s[k] ?? "");
      map.push(src);
    }
  };

  let i = 0;
  while (i < input.length) {
    const start = i;
    const cp = input.codePointAt(i) ?? 0;
    let j = i + (cp > 0xffff ? 2 : 1);
    // Extend the cluster over trailing combining marks so a decomposed
    // base+mark sequence composes under NFKC instead of leaking a bare mark.
    while (j < input.length) {
      const mcp = input.codePointAt(j) ?? 0;
      if (!isMark(mcp)) break;
      j += mcp > 0xffff ? 2 : 1;
    }
    const cluster = input.slice(start, j);
    i = j;

    // NFKC is identity on a lone ASCII char; skip the call for the common case.
    const nf = cluster.length === 1 && cp < 0x80 ? cluster : cluster.normalize("NFKC");
    for (const ch of nf) {
      const code = ch.codePointAt(0) ?? 0;
      if (ZERO_WIDTH.has(code)) continue;
      emit(fold(ch), start);
    }
  }
  map.push(input.length);
  return { text: out.join(""), map: Int32Array.from(map) };
}

export function normalizeQuery(input: string): string {
  return normalizeForSearch(input).text;
}
