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

// Typst/LaTeX render typographic substitutes that the PDF text layer
// surfaces as their printable Unicode forms, while the source keeps the
// ASCII input. Fold both sides to a shared canonical (ASCII) so the needle
// and haystack match. Dashes are handled separately (they need run-collapse,
// not just aliasing), so this table covers quotes and a few math glyphs.
const TYPOGRAPHIC_ALIAS: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "≤": "<=",
  "≥": ">=",
  "≠": "!=",
};

function isAsciiLetter(ch: string): boolean {
  if (ch.length !== 1) return false;
  const c = ch.charCodeAt(0);
  return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
}

function isAsciiWord(ch: string): boolean {
  if (ch.length !== 1) return false;
  const c = ch.charCodeAt(0);
  return (
    (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c === 0x5f
  );
}

// Inline markup PDFs strip but source keeps. We swallow openers/closers so
// `_Negotiated Autonomy_` in Typst source matches `Negotiated Autonomy` from
// the PDF text layer, while keeping the origIndex invariant intact (every
// emitted character points back to its position in the original source).
const TYPST_EMPHASIS_LOOKAHEAD = 120;
const LATEX_ARG_LOOKAHEAD = 200;
const TYPST_FUNC_LOOKAHEAD = 80;
const LATEX_EMIT_CMDS = ["emph", "textit", "textbf"] as const;

function tryMatchLatexCommand(nfkc: string, i: number): { name: string; argStart: number } | null {
  // nfkc[i] is assumed to be "\\".
  for (const name of [...LATEX_EMIT_CMDS, "cite"]) {
    const probe = `\\${name}{`;
    if (nfkc.startsWith(probe, i)) {
      return { name, argStart: i + probe.length };
    }
  }
  return null;
}

function findClosing(nfkc: string, from: number, close: string, limit: number): number {
  const hi = Math.min(nfkc.length, from + limit);
  for (let j = from; j < hi; j += 1) {
    if (nfkc[j] === close) return j;
  }
  return -1;
}

function normalizeWithMap(raw: string): NormalizedText {
  const nfkc = raw.normalize("NFKC");
  const normalized: string[] = [];
  const origIndex: number[] = [];
  let prevWasSpace = false;
  // Positions at which the current char should be swallowed (markup closer).
  // A stack because a `#par[` wrapper can contain `_emphasis_` runs; we want
  // to skip the emphasis-closer `_` before we reach the `#par` closer `]`.
  const swallowAt: number[] = [];
  let i = 0;
  while (i < nfkc.length) {
    if (swallowAt.length > 0 && swallowAt[swallowAt.length - 1] === i) {
      swallowAt.pop();
      i += 1;
      continue;
    }
    const ch = nfkc[i] ?? "";
    if (ch === SOFT_HYPHEN) {
      i += 1;
      continue;
    }
    // Typst inline emphasis: `_italic_` / `*bold*`. Word-boundary guarded so
    // `snake_case` identifiers pass through untouched. Lookahead is bounded
    // to 120 chars — an emphasis span may cross a soft line wrap (Typst
    // allows it), but the bound keeps a stray `_` from eating a paragraph.
    // A blank line (two consecutive newlines) ends a Typst paragraph, so
    // treat that as an uncrossable boundary.
    if (ch === "_" || ch === "*") {
      const before = nfkc[i - 1] ?? "";
      if (!isAsciiWord(before)) {
        const limit = Math.min(nfkc.length, i + 1 + TYPST_EMPHASIS_LOOKAHEAD);
        let closer = -1;
        for (let j = i + 1; j < limit; j += 1) {
          const c = nfkc[j];
          if (c === "\n" && nfkc[j + 1] === "\n") break;
          if (c === ch) {
            closer = j;
            break;
          }
        }
        if (closer !== -1) {
          const after = nfkc[closer + 1] ?? "";
          if (!isAsciiWord(after)) {
            swallowAt.push(closer);
            i += 1;
            continue;
          }
        }
      }
    }
    // LaTeX inline commands. `\emph{x}` / `\textit{x}` / `\textbf{x}` keep
    // the argument text; `\cite{x}` drops the whole call because the PDF
    // renders a numeral, not the key.
    if (ch === "\\") {
      const match = tryMatchLatexCommand(nfkc, i);
      if (match !== null) {
        const close = findClosing(nfkc, match.argStart, "}", LATEX_ARG_LOOKAHEAD);
        if (close !== -1) {
          if (match.name === "cite") {
            i = close + 1;
            continue;
          }
          swallowAt.push(close);
          i = match.argStart;
          continue;
        }
      }
    }
    // Typst function calls. `#cite(...)`, `#v(...)`, `#h(...)` drop wholly;
    // `#set ...\n` and `#show ...\n` are line-scoped directives; `#par[`
    // and `#align(...)[` wrap prose — keep their `[...]` body, drop the
    // chrome leading up to and including the opening bracket. Unknown `#`
    // patterns fall through as a regular character.
    if (ch === "#") {
      if (nfkc.startsWith("#cite(", i)) {
        const close = findClosing(nfkc, i + 6, ")", TYPST_FUNC_LOOKAHEAD);
        if (close !== -1) {
          i = close + 1;
          continue;
        }
      }
      if (nfkc.startsWith("#v(", i) || nfkc.startsWith("#h(", i)) {
        const close = findClosing(nfkc, i + 3, ")", TYPST_FUNC_LOOKAHEAD);
        if (close !== -1) {
          i = close + 1;
          continue;
        }
      }
      if (nfkc.startsWith("#set ", i) || nfkc.startsWith("#show ", i)) {
        const nl = nfkc.indexOf("\n", i);
        i = nl === -1 ? nfkc.length : nl + 1;
        continue;
      }
      if (nfkc.startsWith("#par[", i)) {
        i += 5;
        continue;
      }
      if (nfkc.startsWith("#align(", i)) {
        const close = findClosing(nfkc, i + 7, ")", TYPST_FUNC_LOOKAHEAD);
        if (close !== -1 && nfkc[close + 1] === "[") {
          i = close + 2;
          continue;
        }
      }
    }
    // Typst inline math: `$<= 7 %$`. The PDF renders the content without
    // the `$` delimiters, so swallow matched pairs. Bounded lookahead; if
    // there's no closer within ~80 chars, fall through.
    if (ch === "$") {
      const close = findClosing(nfkc, i + 1, "$", TYPST_FUNC_LOOKAHEAD);
      if (close !== -1) {
        swallowAt.push(close);
        i += 1;
        continue;
      }
    }
    // PDF line-break hyphenation: text-item extraction produces `irre-
    // versible` (hyphen, then whitespace, then continuation on a new line)
    // where the source has plain `irreversible`. When we see `<letter>-` at
    // a position where the next non-whitespace character is also a letter,
    // treat the hyphen + following whitespace as a word-joining artifact
    // and swallow it. Real compounds like `state-of-the-art` are unaffected
    // because they have no whitespace after the hyphen; list separators like
    // `dogs - cats` are unaffected because they have whitespace BEFORE the
    // hyphen (so there's no letter immediately preceding it).
    if (ch === "-" && isAsciiLetter(nfkc[i - 1] ?? "") && /\s/.test(nfkc[i + 1] ?? "")) {
      let j = i + 1;
      while (j < nfkc.length && /\s/.test(nfkc[j] ?? "")) j += 1;
      if (isAsciiLetter(nfkc[j] ?? "")) {
        i = j;
        continue;
      }
    }
    // Dash-run canonicalization. Source uses `--` for en-dash and `---` for
    // em-dash (Typst/LaTeX auto-substitute); the PDF surfaces the rendered
    // `–` / `—`. Collapse any run of dash-like characters into a single
    // ASCII `-` and map both sides onto that canonical form. Compound words
    // like `state-of-the-art` (single-dash runs) pass through unchanged.
    if (ch === "-" || ch === "–" || ch === "—" || ch === "−") {
      let j = i;
      while (j < nfkc.length) {
        const cj = nfkc[j] ?? "";
        if (cj === "-" || cj === "–" || cj === "—" || cj === "−") j += 1;
        else break;
      }
      normalized.push("-");
      origIndex.push(i);
      prevWasSpace = false;
      i = j;
      continue;
    }
    // Smart quotes and a few math glyphs that Typst auto-substitutes. Fold
    // to the ASCII form so source and PDF converge on the same character.
    const alias = TYPOGRAPHIC_ALIAS[ch];
    if (alias !== undefined) {
      for (const out of alias) {
        normalized.push(out.toLowerCase());
        origIndex.push(i);
      }
      prevWasSpace = false;
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

function locateSpan(
  sourceFile: string,
  sourceText: string,
  origIndex: readonly number[],
  matchStartNorm: number,
  matchEndNorm: number,
): ResolveResult {
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
  if (runHits.length === 1 && runParts.length > 1) {
    const runStart = runHits[0] ?? 0;
    // The quote sits inside the run after contextBefore + (optional) space.
    const prefix = contextBeforeNorm.length > 0 ? `${contextBeforeNorm} ` : "";
    const matchStartNorm = runStart + prefix.length;
    return locateSpan(
      sourceFile,
      sourceText,
      origIndex,
      matchStartNorm,
      matchStartNorm + quoteNorm.length,
    );
  }

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
  return locateSpan(sourceFile, sourceText, origIndex, only, only + quoteNorm.length);
}

export interface MultiFileCandidate {
  relPath: string;
  text: string;
}

// Multi-file resolver. Unlike `resolveAnnotationSpan`, which assumes the
// quote, contextBefore, and contextAfter all live in the same source file,
// this walks a candidate set (typically the PDF-sibling sources) and
// resolves a quote even when its PDF context spans other files. Rules:
//
//   - If the normalized quote appears exactly once across the whole candidate
//     set, resolve to that hit. No context check needed — a globally unique
//     quote is its own anchor.
//   - If it appears in multiple places, use context proximity (±400 chars,
//     within the same file) to disambiguate. Exactly one viable hit →
//     resolved; zero or more than one → ambiguous.
//   - If it appears nowhere → ambiguous.
export function resolveAcrossFiles(
  candidates: ReadonlyArray<MultiFileCandidate>,
  input: ResolveInput,
): ResolveResult {
  const quoteNorm = normalizeNeedle(input.quote);
  if (quoteNorm.length === 0) return { kind: "ambiguous" };

  const contextBeforeNorm = normalizeNeedle(input.contextBefore);
  const contextAfterNorm = normalizeNeedle(input.contextAfter);

  type FileHits = {
    candidate: MultiFileCandidate;
    haystack: string;
    origIndex: number[];
    hits: number[];
  };
  const filesWithHits: FileHits[] = [];
  for (const c of candidates) {
    const { normalized: haystack, origIndex } = normalizeWithMap(c.text);
    const hits = findAllOccurrences(haystack, quoteNorm);
    if (hits.length > 0) {
      filesWithHits.push({ candidate: c, haystack, origIndex, hits });
    }
  }

  const totalHits = filesWithHits.reduce((sum, f) => sum + f.hits.length, 0);
  if (totalHits === 0) return { kind: "ambiguous" };

  if (totalHits === 1) {
    const f = filesWithHits[0];
    const hit = f?.hits[0];
    if (!f || hit === undefined) return { kind: "ambiguous" };
    return locateSpan(
      f.candidate.relPath,
      f.candidate.text,
      f.origIndex,
      hit,
      hit + quoteNorm.length,
    );
  }

  // Multiple hits — use context proximity, within each candidate, to choose.
  const viable: Array<{ f: FileHits; hit: number }> = [];
  for (const f of filesWithHits) {
    for (const hit of f.hits) {
      const beforeHit =
        contextBeforeNorm.length > 0
          ? nearestContextHit(f.haystack, contextBeforeNorm, hit, 400)
          : null;
      const afterHit =
        contextAfterNorm.length > 0
          ? nearestContextHit(f.haystack, contextAfterNorm, hit + quoteNorm.length, 400)
          : null;
      if (beforeHit !== null || afterHit !== null) {
        viable.push({ f, hit });
      }
    }
  }
  if (viable.length !== 1) return { kind: "ambiguous" };
  const chosen = viable[0];
  if (!chosen) return { kind: "ambiguous" };
  return locateSpan(
    chosen.f.candidate.relPath,
    chosen.f.candidate.text,
    chosen.f.origIndex,
    chosen.hit,
    chosen.hit + quoteNorm.length,
  );
}
