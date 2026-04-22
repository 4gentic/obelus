// PDF-anchored annotations carry a `quote + contextBefore + contextAfter` run
// extracted from the rendered PDF. The Claude plugin's `plan-fix` skill hunts
// for that run inside the paper source with Grep/Read + fuzzy matching before
// it can propose any diff — N tool roundtrips per annotation. When the
// desktop knows the paper source up-front (single-paper writer projects), we
// can do the same match locally and hand the plugin a `source` anchor so it
// jumps straight to "read these lines and propose a diff".
//
// The normalization here intentionally mirrors the skill's own rules (see
// `packages/claude-plugin/skills/plan-fix/SKILL.md`, "Locating the source
// span"): NFKC, fold `ﬁ`/`ﬂ`, strip soft hyphens, collapse whitespace, and
// lowercase for comparison only. Ambiguous matches fall back to the PDF
// anchor — the skill's fuzzy path remains the safety net.

export interface SourceSpan {
  file: string;
  lineStart: number;
  colStart: number;
  lineEnd: number;
  colEnd: number;
}

export interface ResolveInput {
  quote: string;
  contextBefore: string;
  contextAfter: string;
}

interface NormalizedText {
  normalized: string;
  // For every index i in `normalized`, origIndex[i] is the offset into the
  // original (un-normalized) string where that character started. Needed to
  // map a normalized-space match back to an original-text span.
  origIndex: number[];
}

const LIGATURES: Record<string, string> = {
  ﬀ: "ff",
  ﬁ: "fi",
  ﬂ: "fl",
  ﬃ: "ffi",
  ﬄ: "ffl",
  ﬅ: "st",
  ﬆ: "st",
};
const SOFT_HYPHEN = "­";

function normalizeWithMap(raw: string): NormalizedText {
  const nfkc = raw.normalize("NFKC");
  const normalized: string[] = [];
  const origIndex: number[] = [];
  let prevWasSpace = false;
  let i = 0;
  while (i < nfkc.length) {
    const ch = nfkc[i] ?? "";
    if (ch === SOFT_HYPHEN) {
      i += 1;
      continue;
    }
    const ligature = LIGATURES[ch];
    if (ligature !== undefined) {
      for (const out of ligature) {
        normalized.push(out.toLowerCase());
        origIndex.push(i);
      }
      prevWasSpace = false;
      i += 1;
      continue;
    }
    if (/\s/.test(ch)) {
      if (prevWasSpace) {
        i += 1;
        continue;
      }
      normalized.push(" ");
      origIndex.push(i);
      prevWasSpace = true;
      i += 1;
      continue;
    }
    normalized.push(ch.toLowerCase());
    origIndex.push(i);
    prevWasSpace = false;
    i += 1;
  }
  return { normalized: normalized.join(""), origIndex };
}

function normalizeNeedle(raw: string): string {
  const { normalized } = normalizeWithMap(raw);
  return normalized.trim();
}

function findAllOccurrences(haystack: string, needle: string): number[] {
  if (needle.length === 0) return [];
  const hits: number[] = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    hits.push(idx);
    from = idx + 1;
  }
  return hits;
}

function offsetToLineCol(raw: string, offset: number): { line: number; col: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset; i += 1) {
    if (raw[i] === "\n") {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, col: offset - lineStart };
}

function nearestContextHit(
  haystackNorm: string,
  contextNorm: string,
  aroundOffset: number,
  window: number,
): number | null {
  if (contextNorm.length === 0) return null;
  const lo = Math.max(0, aroundOffset - window - contextNorm.length);
  const hi = Math.min(haystackNorm.length, aroundOffset + window);
  const slice = haystackNorm.slice(lo, hi);
  const local = slice.indexOf(contextNorm);
  return local === -1 ? null : lo + local;
}

export interface ResolveResult {
  kind: "resolved" | "ambiguous";
  span?: SourceSpan;
}

export function resolveAnnotationSpan(
  sourceFile: string,
  sourceText: string,
  input: ResolveInput,
): ResolveResult {
  const { normalized: haystack, origIndex } = normalizeWithMap(sourceText);
  const quoteNorm = normalizeNeedle(input.quote);
  if (quoteNorm.length === 0) return { kind: "ambiguous" };

  const contextBeforeNorm = normalizeNeedle(input.contextBefore);
  const contextAfterNorm = normalizeNeedle(input.contextAfter);

  // Preferred: the run contextBefore + quote + contextAfter lands uniquely.
  // `normalizeNeedle` already trimmed each fragment, so join with a single
  // space to match whitespace-collapsed source.
  const runParts = [contextBeforeNorm, quoteNorm, contextAfterNorm].filter((s) => s.length > 0);
  const run = runParts.join(" ");
  const runHits = findAllOccurrences(haystack, run);
  let matchStartNorm: number | null = null;
  let matchEndNorm: number | null = null;
  if (runHits.length === 1 && runParts.length > 1) {
    const runStart = runHits[0] ?? 0;
    // The quote sits inside the run after contextBefore + (optional) space.
    const prefix = contextBeforeNorm.length > 0 ? `${contextBeforeNorm} ` : "";
    matchStartNorm = runStart + prefix.length;
    matchEndNorm = matchStartNorm + quoteNorm.length;
  } else {
    // Fallback: find quote alone, then require one of the contexts to land
    // within ±400 chars. If neither context aligns (or still multiple hits),
    // mark ambiguous — do not guess.
    const quoteHits = findAllOccurrences(haystack, quoteNorm);
    if (quoteHits.length === 0) return { kind: "ambiguous" };
    const viable = quoteHits.filter((hit) => {
      if (contextBeforeNorm.length === 0 && contextAfterNorm.length === 0) {
        return quoteHits.length === 1;
      }
      const beforeHit =
        contextBeforeNorm.length > 0
          ? nearestContextHit(haystack, contextBeforeNorm, hit, 400)
          : null;
      const afterHit =
        contextAfterNorm.length > 0
          ? nearestContextHit(haystack, contextAfterNorm, hit + quoteNorm.length, 400)
          : null;
      return beforeHit !== null || afterHit !== null;
    });
    if (viable.length !== 1) return { kind: "ambiguous" };
    const only = viable[0] ?? 0;
    matchStartNorm = only;
    matchEndNorm = only + quoteNorm.length;
  }

  if (matchStartNorm === null || matchEndNorm === null) return { kind: "ambiguous" };

  const startOrig = origIndex[matchStartNorm];
  // End offset is exclusive in normalized space; map the last char then +1.
  const lastNormIdx = matchEndNorm - 1;
  const lastOrig = origIndex[lastNormIdx];
  if (startOrig === undefined || lastOrig === undefined) {
    return { kind: "ambiguous" };
  }
  const endOrig = lastOrig + 1;

  const startLc = offsetToLineCol(sourceText, startOrig);
  const endLc = offsetToLineCol(sourceText, endOrig);

  return {
    kind: "resolved",
    span: {
      file: sourceFile,
      lineStart: startLc.line,
      colStart: startLc.col,
      lineEnd: endLc.line,
      colEnd: endLc.col,
    },
  };
}
