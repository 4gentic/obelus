// Presentation-only routing: does this change read as source (markup/code) or as
// prose? The answer picks the renderer — a compact monospace line diff for code,
// the serif word-level redline for prose — and never touches the stored patch or
// the apply path. It is a heuristic, deliberately, because the alternative is
// asking the engine to label every hunk; the cost of a wrong guess is cosmetic.

// A trimmed, non-empty line carries a code signal if any of these hold.
function lineLooksLikeCode(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === "") return false;

  // LaTeX command/environment, or a LaTeX comment.
  if (trimmed.startsWith("\\")) return true;
  if (trimmed.startsWith("%")) return true;
  // C-style comment (LaTeX listings, code blocks).
  if (trimmed.startsWith("//") || trimmed.startsWith("/*")) return true;

  // A Typst call — `#set page(...)`, `#align(center)[...]`. The char after `#`
  // must be an identifier start, which rules out a Markdown heading (`# Title`,
  // where a space follows the hash).
  if (/^#[A-Za-z_]/.test(trimmed) && /[([]/.test(trimmed)) return true;

  // An open delimiter or a continuation punctuation at the end of the line reads
  // as structure, not a sentence.
  if (/[{[(,;]$/.test(trimmed)) return true;

  // `key: value` / `key = value` with no sentence-ending punctuation — a config
  // or attribute line, not prose. A trailing `.`/`!`/`?` means it's a sentence
  // that merely contains a colon.
  if (/^[\w.-]+\s*[:=]\s*\S/.test(trimmed) && !/[.!?]$/.test(trimmed)) return true;

  // Mostly non-alphabetic: punctuation, braces, operators. Prose is dense in
  // letters; a line under ~55% letters is almost never a sentence.
  const letters = trimmed.replace(/[^A-Za-z]/g, "").length;
  if (letters / trimmed.length < 0.55) return true;

  return false;
}

// True when at least half the non-empty lines across before+after read as code.
// One inline `\cite{x}` in a paragraph won't tip a prose edit; a preamble where
// every line is a `#set`/`\usepackage` will.
export function looksLikeCode(before: string, after: string): boolean {
  const lines = [...before.split("\n"), ...after.split("\n")].filter((l) => l.trim() !== "");
  if (lines.length === 0) return false;

  const codeLines = lines.filter(lineLooksLikeCode).length;
  return codeLines / lines.length >= 0.5;
}

// A change is "heavy" when most of a sizable passage was rewritten. Inline
// strike-and-underline of such a passage reads as noise — neither the result nor
// the edits stay legible — so the renderer shows the original and the result as
// two blocks instead. Short changes stay inline whatever the ratio: a two-word
// swap is clearer on one line than split across two blocks.
const HEAVY_RATIO = 0.5;
const HEAVY_MIN_CHARS = 200;

export interface DiffRun {
  value: string[];
  added?: boolean;
  removed?: boolean;
}

export function isHeavyRewrite(runs: ReadonlyArray<DiffRun>): boolean {
  let changed = 0;
  let total = 0;
  for (const run of runs) {
    const len = run.value.join("").length;
    total += len;
    if (run.added === true || run.removed === true) changed += len;
  }
  return total >= HEAVY_MIN_CHARS && changed / total >= HEAVY_RATIO;
}
