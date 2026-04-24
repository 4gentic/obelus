// Document-wide bidirectional source ↔ rendered offset map for a markdown
// paper. Produced by walking `mdast-util-from-markdown`'s parse tree in DFS
// order and emitting one breakpoint per text-bearing leaf (text, inlineCode,
// hard break). The map lets two hops that the existing column arithmetic gets
// wrong work cleanly:
//
//   - Selection → SourceAnchor: rendered DOM offset → source col, accounting
//     for stripped markdown delimiters (`**`, backticks, `[text](url)`).
//   - SourceAnchor → highlight rects: source col → DOM rendered offset, the
//     same translation in reverse.
//
// `buildDocumentSourceMap` parses once per text change; the adapter memoises
// the result so per-mouseup / per-paint cost is O(breakpoints).
import type { Root as MdastRoot } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { visit } from "unist-util-visit";

export interface OffsetBreakpoint {
  // Offset of this run's first char in the doc-wide concatenated rendered
  // string. Sequential breakpoints share no gap — `breakpoints[i+1]
  // .renderedStart === breakpoints[i].renderedStart + breakpoints[i].length`.
  renderedStart: number;
  // Offset of this run's first char in the source `text`. Successive
  // breakpoints can have a gap here (the bytes between are markdown syntax).
  sourceStart: number;
  length: number;
}

export interface DocumentSourceMap {
  rendered: string;
  breakpoints: ReadonlyArray<OffsetBreakpoint>;
}

function countLeadingBackticks(text: string, from: number): number {
  let n = 0;
  while (from + n < text.length && text.charCodeAt(from + n) === 96) n += 1;
  return n;
}

export function buildDocumentSourceMap(text: string): DocumentSourceMap | null {
  let tree: MdastRoot;
  try {
    tree = fromMarkdown(text, {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    });
  } catch {
    return null;
  }
  const breakpoints: OffsetBreakpoint[] = [];
  const parts: string[] = [];
  let rendered = 0;
  visit(tree, (node) => {
    const pos = node.position;
    if (!pos) return;
    const srcStart = pos.start.offset;
    if (srcStart === undefined) return;
    if (node.type === "text") {
      const value = node.value;
      breakpoints.push({ renderedStart: rendered, sourceStart: srcStart, length: value.length });
      parts.push(value);
      rendered += value.length;
      return;
    }
    if (node.type === "inlineCode") {
      const value = node.value;
      const delim = countLeadingBackticks(text, srcStart);
      breakpoints.push({
        renderedStart: rendered,
        sourceStart: srcStart + delim,
        length: value.length,
      });
      parts.push(value);
      rendered += value.length;
      return;
    }
    if (node.type === "break") {
      breakpoints.push({ renderedStart: rendered, sourceStart: srcStart, length: 1 });
      parts.push("\n");
      rendered += 1;
    }
  });
  return { rendered: parts.join(""), breakpoints };
}

// `bias` resolves the boundary case where `renderedIdx` equals one
// breakpoint's end and the next breakpoint's start simultaneously — e.g. the
// rendered "o" at the end of inline code and the space that follows are
// adjacent in rendered text but separated by a closing backtick in source.
// For a selection's start we want the later breakpoint's sourceStart (past
// the opening delim); for its end we want the earlier breakpoint's end.
export function mapRenderedToSource(
  breakpoints: ReadonlyArray<OffsetBreakpoint>,
  renderedIdx: number,
  bias: "start" | "end",
): number | null {
  if (bias === "start") {
    for (const bp of breakpoints) {
      const bpEnd = bp.renderedStart + bp.length;
      if (renderedIdx >= bp.renderedStart && renderedIdx < bpEnd) {
        return bp.sourceStart + (renderedIdx - bp.renderedStart);
      }
    }
    const last = breakpoints[breakpoints.length - 1];
    if (last && renderedIdx === last.renderedStart + last.length) {
      return last.sourceStart + last.length;
    }
    return null;
  }
  for (let i = breakpoints.length - 1; i >= 0; i -= 1) {
    const bp = breakpoints[i];
    if (!bp) continue;
    const bpEnd = bp.renderedStart + bp.length;
    if (renderedIdx > bp.renderedStart && renderedIdx <= bpEnd) {
      return bp.sourceStart + (renderedIdx - bp.renderedStart);
    }
  }
  const first = breakpoints[0];
  if (first && renderedIdx === 0) return first.sourceStart;
  return null;
}

// Inverse of `mapRenderedToSource`. Given a source offset, find the rendered
// offset of the same character. Boundary semantics mirror the inverse: at a
// breakpoint boundary, "start" picks the later run's renderedStart, "end"
// picks the earlier run's renderedEnd. A source offset that lands inside a
// markdown delimiter (`**`, backticks) — i.e. between two breakpoints — has
// no rendered equivalent; `bias` decides which side of the gap to snap to.
export function mapSourceToRendered(
  breakpoints: ReadonlyArray<OffsetBreakpoint>,
  sourceIdx: number,
  bias: "start" | "end",
): number | null {
  // Inside a breakpoint: 1:1 mapping.
  for (let i = 0; i < breakpoints.length; i += 1) {
    const bp = breakpoints[i];
    if (!bp) continue;
    const bpSrcEnd = bp.sourceStart + bp.length;
    if (sourceIdx >= bp.sourceStart && sourceIdx < bpSrcEnd) {
      return bp.renderedStart + (sourceIdx - bp.sourceStart);
    }
  }
  // Boundary cases — sourceIdx lands at a run's end or in the syntax between
  // two runs. Snap based on bias.
  if (bias === "start") {
    // Snap forward to the next run's start (skip closing delimiter).
    for (let i = 0; i < breakpoints.length; i += 1) {
      const bp = breakpoints[i];
      if (!bp) continue;
      if (bp.sourceStart >= sourceIdx) return bp.renderedStart;
    }
    const last = breakpoints[breakpoints.length - 1];
    return last ? last.renderedStart + last.length : null;
  }
  // bias === "end": snap back to the previous run's end (skip opening delim).
  let candidate: OffsetBreakpoint | null = null;
  for (let i = 0; i < breakpoints.length; i += 1) {
    const bp = breakpoints[i];
    if (!bp) continue;
    if (bp.sourceStart + bp.length <= sourceIdx) candidate = bp;
    else break;
  }
  if (candidate) return candidate.renderedStart + candidate.length;
  const first = breakpoints[0];
  return first ? first.renderedStart : null;
}

export function computeLineOffsets(text: string): ReadonlyArray<number> {
  const offsets: number[] = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) offsets.push(i + 1);
  }
  return offsets;
}

export function sourceOffsetToLineCol(
  offset: number,
  lineOffsets: ReadonlyArray<number>,
): { line: number; col: number } {
  let lo = 0;
  let hi = lineOffsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    const v = lineOffsets[mid];
    if (v !== undefined && v <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, col: offset - (lineOffsets[lo] ?? 0) };
}

// `(line, col)` → absolute source offset. Mirrors `sourceOffsetToLineCol`.
// Returns null when the line is out of range.
export function lineColToSourceOffset(
  line: number,
  col: number,
  lineOffsets: ReadonlyArray<number>,
): number | null {
  const base = lineOffsets[line - 1];
  if (base === undefined) return null;
  return base + col;
}
