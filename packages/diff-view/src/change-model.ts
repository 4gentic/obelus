import { structuredPatch } from "diff";

export interface ParsedChange {
  /** The original lines the hunk replaces, joined by "\n". Empty for a pure insertion. */
  before: string;
  /** The proposed replacement, joined by "\n". Empty for a pure deletion. */
  after: string;
  /** Up to two source lines immediately preceding the change, for orientation. */
  contextBefore: string[];
  /** Up to two source lines immediately following the change, for orientation. */
  contextAfter: string[];
  oldStart: number;
  oldCount: number;
}

interface HunkHeader {
  oldStart: number;
  oldCount: number;
}

const HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/;
const CONTEXT_SPAN = 2;

function parseHeader(line: string): HunkHeader | null {
  const m = HEADER_RE.exec(line);
  if (!m) return null;
  const oldStart = Number(m[1]);
  const oldCount = m[2] === undefined ? 1 : Number(m[2]);
  if (!Number.isFinite(oldStart) || !Number.isFinite(oldCount)) return null;
  return { oldStart, oldCount };
}

function bodyLines(patch: string): string[] {
  const lines = patch.split("\n");
  const trailing = lines.at(-1);
  const trimmed = trailing === "" ? lines.slice(0, -1) : lines;
  return trimmed.slice(1);
}

// Reconstruct `before` from the patch body alone (context + deletions, prefix
// stripped). Used only when the source text is unavailable; the `\ No newline`
// marker that some emitters append is never a content line, so it is dropped.
function beforeFromBody(body: ReadonlyArray<string>): string {
  const kept: string[] = [];
  for (const raw of body) {
    if (raw.startsWith("\\")) continue;
    if (raw.startsWith("+")) continue;
    kept.push(raw.slice(1));
  }
  return kept.join("\n");
}

function afterFromBody(body: ReadonlyArray<string>): string {
  const kept: string[] = [];
  for (const raw of body) {
    if (raw.startsWith("\\")) continue;
    if (raw.startsWith("-")) continue;
    kept.push(raw.slice(1));
  }
  return kept.join("\n");
}

export function parseChange(patch: string, sourceText: string | null): ParsedChange | null {
  if (patch === "") return null;
  const firstLine = patch.split("\n", 1)[0] ?? "";
  const header = parseHeader(firstLine);
  if (header === null) return null;

  const body = bodyLines(patch);
  const after = afterFromBody(body);

  if (sourceText === null) {
    return {
      before: beforeFromBody(body),
      after,
      contextBefore: [],
      contextAfter: [],
      oldStart: header.oldStart,
      oldCount: header.oldCount,
    };
  }

  const src = sourceText.split("\n");
  const from = header.oldStart - 1;
  const to = from + header.oldCount;
  const before = src.slice(from, to).join("\n");
  const contextBefore = src.slice(Math.max(0, from - CONTEXT_SPAN), from);
  const contextAfter = src.slice(to, Math.min(src.length, to + CONTEXT_SPAN));

  return {
    before,
    after,
    contextBefore,
    contextAfter,
    oldStart: header.oldStart,
    oldCount: header.oldCount,
  };
}

// Format jsdiff's structured hunks into the project's stored-patch shape:
// `@@ -a,b +c,d @@` followed by the body lines, hunks joined by "\n". No
// `---`/`+++`/`Index:` file headers — stored patches and the Rust apply path
// (apps/desktop/src-tauri/src/commands/apply.rs) carry only the hunk.
function formatHunks(
  hunks: ReadonlyArray<{
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: string[];
  }>,
): string {
  return hunks
    .map((h) => {
      const head = `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`;
      return [head, ...h.lines].join("\n");
    })
    .join("\n");
}

export function synthesizePatch(
  sourceText: string,
  originalPatch: string,
  editedAfter: string,
): string {
  const header = parseHeader(originalPatch.split("\n", 1)[0] ?? "");
  if (header === null) return "";

  const endsWithNewline = sourceText.endsWith("\n");
  // Splitting "a\nb\n" yields ["a", "b", ""]; drop that trailing sentinel so a
  // splice doesn't reintroduce it as a real line, then restore the file's own
  // terminator convention on both sides. Editing in the middle of a file then
  // re-joining with the original terminator keeps the unchanged tail identical,
  // so structuredPatch sees no spurious final-line diff.
  const srcLines = sourceText.split("\n");
  if (endsWithNewline) srcLines.pop();
  const editedLines = editedAfter.split("\n");

  const from = header.oldStart - 1;
  const to = from + header.oldCount;
  const newLines = [...srcLines.slice(0, from), ...editedLines, ...srcLines.slice(to)];

  const terminator = endsWithNewline ? "\n" : "";
  const newFile = newLines.join("\n") + terminator;

  const patch = structuredPatch("a", "b", sourceText, newFile, "", "", { context: 3 });
  return formatHunks(patch.hunks);
}
