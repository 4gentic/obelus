import type { SourceAnchor2 } from "@obelus/bundle-schema";
import { normalizeQuote } from "./anchor";

// Node.ELEMENT_NODE / Node.TEXT_NODE are DOM globals that don't exist in
// plain Node.js runtimes (CLI scripts, workers). Hardcoding the well-known
// integers keeps these helpers usable in any host that supplies a DOM tree.
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

// Walks up from a Node to the nearest ancestor (inclusive) carrying the
// `data-src-file` attribute. Block-level renderers (markdown, latex)
// stamp this attribute on every block, so any text node inside the
// rendered preview reaches a tagged ancestor.
function findSourceBlock(node: Node | null): HTMLElement | null {
  let current: Node | null = node;
  while (current) {
    if (current.nodeType === ELEMENT_NODE) {
      const el = current as HTMLElement;
      if (el.hasAttribute("data-src-file")) return el;
    }
    current = current.parentNode;
  }
  return null;
}

function readNumberAttr(el: HTMLElement, name: string): number | null {
  const raw = el.getAttribute(name);
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) ? null : n;
}

// Counts UTF-16 code units of text content from the start of `block` up to
// (and excluding) `targetNode`'s `targetOffset`. The renderer stamps
// `data-src-col` on the block representing the *start* column of the block
// in the source; adding this in-block offset gives the column of the
// selection endpoint.
function offsetWithinBlock(block: HTMLElement, targetNode: Node, targetOffset: number): number {
  let count = 0;
  let found = false;

  const walk = (node: Node): void => {
    if (found) return;
    if (node === targetNode) {
      if (node.nodeType === TEXT_NODE) {
        count += targetOffset;
      }
      found = true;
      return;
    }
    if (node.nodeType === TEXT_NODE) {
      count += node.nodeValue?.length ?? 0;
      return;
    }
    if (node.nodeType === ELEMENT_NODE) {
      const el = node as HTMLElement;
      // If the target offset points at a child position of an element
      // (Selection endpoints can land on element nodes too), summarize the
      // first `targetOffset` children.
      if (el === targetNode) {
        for (let i = 0; i < targetOffset && i < el.childNodes.length; i += 1) {
          const child = el.childNodes[i];
          if (child) walk(child);
        }
        found = true;
        return;
      }
      for (let i = 0; i < el.childNodes.length && !found; i += 1) {
        const child = el.childNodes[i];
        if (child) walk(child);
      }
    }
  };

  walk(block);
  return count;
}

type SelectionEndpoint = {
  node: Node;
  offset: number;
};

function endpointToCoord(
  ep: SelectionEndpoint,
): { file: string; lineStart: number; lineEnd: number; col: number } | null {
  const block = findSourceBlock(ep.node);
  if (!block) return null;
  const file = block.getAttribute("data-src-file");
  const line = readNumberAttr(block, "data-src-line");
  const blockCol = readNumberAttr(block, "data-src-col");
  if (file === null || line === null || blockCol === null) return null;
  // Multi-line blocks (code fences, blockquotes) advertise their end line so
  // the verifier reads the full source range. Single-line blocks omit it.
  const endLine = readNumberAttr(block, "data-src-end-line") ?? line;
  const inBlock = offsetWithinBlock(block, ep.node, ep.offset);
  return { file, lineStart: line, lineEnd: endLine, col: blockCol + inBlock };
}

// Maps a Selection in the rendered preview back to a SourceAnchor.
// Returns null when either endpoint sits outside any data-src-file block
// (e.g. the user's cursor landed in the gutter or chrome).
export function selectionToSourceAnchor(
  selection: Pick<Selection, "anchorNode" | "anchorOffset" | "focusNode" | "focusOffset">,
): SourceAnchor2 | null {
  const { anchorNode, focusNode } = selection;
  if (!anchorNode || !focusNode) return null;

  const start = endpointToCoord({ node: anchorNode, offset: selection.anchorOffset });
  const end = endpointToCoord({ node: focusNode, offset: selection.focusOffset });
  if (!start || !end) return null;
  if (start.file !== end.file) return null;

  // Order start before end so a backwards drag still produces a valid anchor.
  const [a, b] =
    start.lineStart < end.lineStart || (start.lineStart === end.lineStart && start.col <= end.col)
      ? [start, end]
      : [end, start];

  return {
    kind: "source",
    file: a.file,
    lineStart: a.lineStart,
    colStart: a.col,
    lineEnd: b.lineEnd,
    colEnd: b.col,
  };
}

// Builds a SourceAnchor for an element (typically an `<img>`) by resolving
// the nearest ancestor that carries `data-src-file` / `data-src-line`. Used by
// the click-to-mark path for images, where the user has no text selection
// to drive `selectionToSourceAnchor`. Returns null when the element is in
// hand-authored HTML (no source pairing).
export function imageElementToSourceAnchor(img: HTMLElement): SourceAnchor2 | null {
  const block = findSourceBlock(img);
  if (!block) return null;
  const file = block.getAttribute("data-src-file");
  const line = readNumberAttr(block, "data-src-line");
  const blockCol = readNumberAttr(block, "data-src-col");
  if (file === null || line === null || blockCol === null) return null;
  const endLine = readNumberAttr(block, "data-src-end-line") ?? line;
  return {
    kind: "source",
    file,
    lineStart: line,
    colStart: blockCol,
    lineEnd: endLine,
    colEnd: blockCol,
  };
}

// Computes the line-start byte offsets for a source file. Index i is the
// offset of the first character of (1-indexed) line i+1; offsets[0] = 0.
function lineOffsets(text: string): Array<number> {
  const offsets: Array<number> = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) offsets.push(i + 1);
  }
  return offsets;
}

// Reads the inclusive line range [lineStart, lineEnd] from the file. Used
// by the verifier — column bounds are intentionally ignored so the round-
// trip survives best-effort column mapping (markdown syntax prefixes,
// LaTeX macro expansion). The plan's contract is "the char range CONTAINS
// the quote", not slice equality.
function readLineRange(text: string, lineStart: number, lineEnd: number): string | null {
  const offsets = lineOffsets(text);
  if (lineStart < 1 || lineEnd < lineStart) return null;
  const startBase = offsets[lineStart - 1];
  if (startBase === undefined) return null;
  // End-of-range = start of (lineEnd + 1) if it exists, else end of text.
  const endBase = offsets[lineEnd] ?? text.length;
  return text.slice(startBase, endBase);
}

// Round-trips a SourceAnchor against the file it references. The caller
// (bundle-builder) flags `sourceMapUnverified: true` on mismatch instead
// of throwing — Phase 5's column mapping is best-effort by design, and
// downstream Claude can still try to apply edits via the quote alone.
export function verifySourceAnchor(
  anchor: SourceAnchor2,
  fileText: string,
  expectedQuote: string,
): { ok: true } | { ok: false; reason: "line-out-of-range" | "quote-mismatch" } {
  const range = readLineRange(fileText, anchor.lineStart, anchor.lineEnd);
  if (range === null) return { ok: false, reason: "line-out-of-range" };
  if (!normalizeQuote(range).includes(normalizeQuote(expectedQuote))) {
    return { ok: false, reason: "quote-mismatch" };
  }
  return { ok: true };
}
