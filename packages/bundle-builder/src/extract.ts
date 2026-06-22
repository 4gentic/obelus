import type { Citation, SourceSection } from "@obelus/bundle-schema";

// Source structure extraction for the review bundle. Pure, format-aware, and
// shared by both apps' exporters: given the text of a source file we know the
// format of, produce its heading outline and the citation keys it references.
// These feed the bundle's navigation hints (`project.files[].sections`,
// top-level `citations`, and per-anchor `scopeStart`/`scopeEnd`) so the
// downstream plugin navigates by line range instead of grepping the paper.
//
// Only the three prose source formats carry structure we can parse. `.bib`,
// `.html`, and binaries return nothing — callers omit the optional fields.

export type SourceFormat = "tex" | "md" | "typ";

export function isStructuredSourceFormat(format: string): format is SourceFormat {
  return format === "tex" || format === "md" || format === "typ";
}

// Heading commands we recognise in LaTeX, in descending outline weight. The
// index drives `level` (1-based). `\part`/`\chapter` are folded to the top
// levels so book-class sources still produce a sane outline.
const LATEX_SECTION_LEVELS = [
  "part",
  "chapter",
  "section",
  "subsection",
  "subsubsection",
  "paragraph",
  "subparagraph",
] as const;

const LATEX_SECTION_RE = new RegExp(
  `^\\s*\\\\(${LATEX_SECTION_LEVELS.join("|")})\\*?\\s*(?:\\[[^\\]]*\\])?\\s*\\{`,
);

// Pull the brace-balanced argument of a `\section{…}` starting at the first
// `{`. Handles nested braces in the heading (`\section{The $f(x)$ case}` is
// fine; `\section{A {nested} title}` returns `A {nested} title`).
function readBracedArg(line: string, openBraceIndex: number): string | null {
  let depth = 0;
  for (let i = openBraceIndex; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return line.slice(openBraceIndex + 1, i);
    }
  }
  return null;
}

function latexHeadings(lines: readonly string[]): RawHeading[] {
  const out: RawHeading[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) continue;
    const m = LATEX_SECTION_RE.exec(line);
    if (!m || m[1] === undefined) continue;
    const level = LATEX_SECTION_LEVELS.indexOf(m[1] as (typeof LATEX_SECTION_LEVELS)[number]) + 1;
    const braceArg = readBracedArg(line, line.indexOf("{", m[0].length - 1));
    out.push({ heading: (braceArg ?? "").trim(), level, lineStart: i + 1 });
  }
  return out;
}

// `\S.*` (not `.*\S`) so the title's leading boundary is fixed at the first
// non-space: a single split point instead of a quantifier pair that both
// consume whitespace and backtrack on a tab-only line (untrusted paper text).
const TYPST_HEADING_RE = /^(=+)\s+(\S.*)$/;

function typstHeadings(lines: readonly string[]): RawHeading[] {
  const out: RawHeading[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) continue;
    const m = TYPST_HEADING_RE.exec(line);
    if (!m || m[1] === undefined || m[2] === undefined) continue;
    out.push({ heading: m[2].trim(), level: m[1].length, lineStart: i + 1 });
  }
  return out;
}

// ATX headings only. `#` must open the line (after optional indent) and be
// followed by whitespace, so a `#tag` or a shebang isn't a heading. Fenced
// code blocks are skipped — a `# comment` inside ``` is not structure.
const MD_HEADING_RE = /^ {0,3}(#{1,6})\s+(.*)$/;
const MD_FENCE_RE = /^\s*(`{3,}|~{3,})/;

// Drop an ATX closing run — trailing whitespace and optional `#`s
// ("## Title ##" → "Title") — in one backward pass. The regex form `/[#\s]+$/`
// that would otherwise tail the heading pattern is quadratic on a crafted line,
// and paper source is untrusted.
function trimAtxClosing(title: string): string {
  let end = title.length;
  while (end > 0) {
    const ch = title[end - 1];
    if (ch === "#" || ch === " " || ch === "\t" || ch === "\r") end -= 1;
    else break;
  }
  return title.slice(0, end);
}

function markdownHeadings(lines: readonly string[]): RawHeading[] {
  const out: RawHeading[] = [];
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) continue;
    const fenceMatch = MD_FENCE_RE.exec(line);
    if (fenceMatch && fenceMatch[1] !== undefined) {
      const marker = fenceMatch[1][0] ?? "`";
      if (fence === null) fence = marker;
      else if (marker === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const m = MD_HEADING_RE.exec(line);
    if (!m || m[1] === undefined) continue;
    out.push({ heading: trimAtxClosing(m[2] ?? ""), level: m[1].length, lineStart: i + 1 });
  }
  return out;
}

interface RawHeading {
  heading: string;
  level: number;
  lineStart: number;
}

// Close each heading's range at the line before the next heading of the same
// or shallower level (or end of file). A subsection nested under a section
// therefore lives *inside* that section's range until a sibling section opens.
function closeRanges(raw: readonly RawHeading[], lineCount: number): SourceSection[] {
  return raw.map((h, idx) => {
    let end = lineCount;
    for (let j = idx + 1; j < raw.length; j += 1) {
      const next = raw[j];
      if (next && next.level <= h.level) {
        end = next.lineStart - 1;
        break;
      }
    }
    return {
      heading: h.heading,
      level: h.level,
      lineStart: h.lineStart,
      lineEnd: Math.max(h.lineStart, end),
    };
  });
}

export function extractSections(text: string, format: SourceFormat): SourceSection[] {
  const lines = text.split("\n");
  const raw =
    format === "tex"
      ? latexHeadings(lines)
      : format === "typ"
        ? typstHeadings(lines)
        : markdownHeadings(lines);
  return closeRanges(raw, lines.length);
}

// Trailing sentence punctuation isn't part of a citation key. Strip it in one
// backward pass; the regex `/[.,;:]+$/` is quadratic on adversarial input and
// paper source is untrusted.
function trimTrailingCiteKeyPunctuation(key: string): string {
  let end = key.length;
  while (end > 0) {
    const ch = key[end - 1];
    if (ch === "." || ch === "," || ch === ";" || ch === ":") end -= 1;
    else break;
  }
  return key.slice(0, end);
}

// `\cite`, `\citep`, `\citet`, `\autocite`, `\parencite`, `\textcite`,
// `\citeauthor`, … — any control word containing "cite", with optional
// bracketed pre/post notes, then a brace list of comma-separated keys. The
// command name is captured whole and filtered in code rather than matched as
// `[a-zA-Z]*cite[a-zA-Z]*`, whose overlap around the literal is quadratic.
const LATEX_CITE_RE = /\\([a-zA-Z]+)(?:\s*\[[^\]]*\])*\s*\{([^}]*)\}/g;

function latexCitationKeys(text: string): string[] {
  const keys: string[] = [];
  for (const m of text.matchAll(LATEX_CITE_RE)) {
    const command = m[1];
    const group = m[2];
    if (command === undefined || group === undefined || !command.includes("cite")) continue;
    for (const k of group.split(",")) {
      const key = k.trim();
      if (key.length > 0) keys.push(key);
    }
  }
  return keys;
}

// Pandoc citations: `[@key]`, `[@a; @b]`, and bare `@key`. The `@` must not be
// preceded by a word character (rules out `foo@bar` emails). Keys are letters,
// digits, and internal `_:.#$%&+?<>~/-` per the pandoc grammar; we stop at the
// first character outside that set.
const MD_CITE_RE = /(?<![\w@])@([\p{L}\d][\w:.#$%&+?<>~/-]*)/gu;

function markdownCitationKeys(text: string): string[] {
  const keys: string[] = [];
  for (const m of text.matchAll(MD_CITE_RE)) {
    const key = m[1];
    if (key !== undefined && key.length > 0) keys.push(trimTrailingCiteKeyPunctuation(key));
  }
  return keys;
}

// Typst references `@label` and explicit `#cite(<label>)` / `#cite(form:
// "...", <label>)`. The label grammar is alnum/`_`/`-`/`.`/`:`. We collect
// both forms; `#cite(label: <l>)` and `#cite(<l>)` both surface the `<l>`.
const TYPST_REF_RE = /(?<![\w@])@([\p{L}\d][\w.:-]*)/gu;
// `[^)]*?` already absorbs leading whitespace, so the redundant `\s*` after `(`
// — which overlaps it and backtracks on a tab run — is dropped.
const TYPST_CITE_RE = /#cite\([^)]*?<([\w.:-]+)>/g;

function typstCitationKeys(text: string): string[] {
  const keys: string[] = [];
  for (const m of text.matchAll(TYPST_REF_RE)) {
    const key = m[1];
    if (key !== undefined && key.length > 0) keys.push(trimTrailingCiteKeyPunctuation(key));
  }
  for (const m of text.matchAll(TYPST_CITE_RE)) {
    const key = m[1];
    if (key !== undefined && key.length > 0) keys.push(key);
  }
  return keys;
}

export function extractCitationKeys(text: string, format: SourceFormat): string[] {
  if (format === "tex") return latexCitationKeys(text);
  if (format === "typ") return typstCitationKeys(text);
  return markdownCitationKeys(text);
}

// The enclosing section for a line is the deepest section whose range contains
// it. Sections are pre-sorted by `lineStart`; the last match wins because a
// subsection opens after its parent and so appears later with a tighter range.
export function scopeForLine(
  sections: readonly SourceSection[],
  line: number,
): { scopeStart: number; scopeEnd: number } | null {
  let found: SourceSection | null = null;
  for (const s of sections) {
    if (line >= s.lineStart && line <= s.lineEnd) found = s;
  }
  return found ? { scopeStart: found.lineStart, scopeEnd: found.lineEnd } : null;
}

// Deduplicate citation keys across every indexed source into the bundle's
// top-level index, preserving first-seen order and counting total references.
export function buildCitationIndex(keysInOrder: readonly string[]): Citation[] {
  const counts = new Map<string, number>();
  for (const key of keysInOrder) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([key, count]) => ({ key, count }));
}
