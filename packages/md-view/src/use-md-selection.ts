import { selectionToSourceAnchor } from "@obelus/anchor";
import type { SourceAnchor2 } from "@obelus/bundle-schema";
import { useEffect, useRef } from "react";
import {
  buildDocumentSourceMap,
  computeLineOffsets,
  mapRenderedToSource,
  sourceOffsetToLineCol,
} from "./source-map";

// Slices the quote and surrounding context from the raw markdown source using
// the anchor's 1-indexed line range + 0-indexed column range. The bundle must
// carry source bytes (with markdown syntax intact) so plan-fix's source-side
// verifier can round-trip — reading the rendered DOM's `innerText` strips
// `**`, backticks, etc. and confuses downstream quote matching.
function sliceSourceSpan(
  text: string,
  anchor: SourceAnchor2,
): { quote: string; contextBefore: string; contextAfter: string } | null {
  const lines = text.split("\n");
  if (anchor.lineStart < 1 || anchor.lineEnd > lines.length) return null;
  let startOffset = 0;
  for (let i = 0; i < anchor.lineStart - 1; i += 1) {
    startOffset += (lines[i]?.length ?? 0) + 1;
  }
  startOffset += anchor.colStart;
  let endOffset = 0;
  for (let i = 0; i < anchor.lineEnd - 1; i += 1) {
    endOffset += (lines[i]?.length ?? 0) + 1;
  }
  endOffset += anchor.colEnd;
  if (startOffset > endOffset) return null;
  if (startOffset < 0 || endOffset > text.length) return null;
  const quote = text.slice(startOffset, endOffset);
  if (quote.trim() === "") return null;
  const contextBefore = text.slice(Math.max(0, startOffset - CONTEXT_CHARS), startOffset);
  const contextAfter = text.slice(endOffset, Math.min(text.length, endOffset + CONTEXT_CHARS));
  return { quote, contextBefore, contextAfter };
}

// Finds the rendered quote inside the mdast-concatenated rendered string and
// returns the matched range's *source* offsets. Two-tier match: exact first,
// then NFKC + whitespace-collapsed fallback that maps back to unnormalized
// haystack positions by scanning forward while skipping whitespace runs. If
// nothing matches (corrupt source, out-of-sync text) we return null so the
// caller falls back to the old slicing path.
function findRenderedInSource(
  rendered: string,
  quote: string,
): { renderedStart: number; renderedEnd: number } | null {
  const trimmed = quote.trim();
  if (trimmed === "") return null;
  const exact = rendered.indexOf(trimmed);
  if (exact !== -1) return { renderedStart: exact, renderedEnd: exact + trimmed.length };

  const normalize = (s: string): string => s.normalize("NFKC").replace(/\s+/g, " ").trim();
  const qNorm = normalize(quote);
  if (qNorm === "") return null;

  // Walk `rendered` once, projecting it onto a NFKC + whitespace-collapsed
  // form while recording the source index each projected char came from.
  // Then indexOf in the projection gives us the projected range; the index
  // array takes us back to `rendered` offsets.
  const nfkc = rendered.normalize("NFKC");
  let projected = "";
  const projectedToNfkc: number[] = [];
  let prevWasWhitespace = true;
  for (let i = 0; i < nfkc.length; i += 1) {
    const ch = nfkc[i];
    if (ch === undefined) continue;
    const isWs = /\s/.test(ch);
    if (isWs) {
      if (!prevWasWhitespace && projected.length > 0) {
        projected += " ";
        projectedToNfkc.push(i);
        prevWasWhitespace = true;
      }
      continue;
    }
    projected += ch;
    projectedToNfkc.push(i);
    prevWasWhitespace = false;
  }
  // Trim trailing space from projected (and its index mapping).
  while (projected.endsWith(" ")) {
    projected = projected.slice(0, -1);
    projectedToNfkc.pop();
  }
  const pIdx = projected.indexOf(qNorm);
  if (pIdx === -1) return null;
  const nStart = projectedToNfkc[pIdx];
  const nEnd = projectedToNfkc[pIdx + qNorm.length - 1];
  if (nStart === undefined || nEnd === undefined) return null;
  // NFKC can shift char counts (ligatures, compatibility equivalents). For the
  // markdown content we actually see, NFKC is ~identity; approximate 1:1 back
  // to `rendered` offsets. If ever it drifts, the refinement returns null and
  // the old path takes over.
  if (nEnd + 1 > rendered.length) return null;
  return { renderedStart: nStart, renderedEnd: nEnd + 1 };
}

// Produces a refined anchor whose colStart/colEnd slice source bytes that
// correspond to what the user visually highlighted. When refinement succeeds
// the returned `quote` is the source slice (markdown delimiters included) —
// matching the bundle's source-bytes contract that `plan-fix` verifies with
// NFKC + whitespace-collapse `.includes()`.
function refineAnchorWithRenderedQuote(
  text: string,
  initialAnchor: SourceAnchor2,
  renderedQuote: string,
): { anchor: SourceAnchor2; quote: string; contextBefore: string; contextAfter: string } | null {
  const built = buildDocumentSourceMap(text);
  if (!built) return null;
  const match = findRenderedInSource(built.rendered, renderedQuote);
  if (!match) return null;
  const srcStart = mapRenderedToSource(built.breakpoints, match.renderedStart, "start");
  const srcEnd = mapRenderedToSource(built.breakpoints, match.renderedEnd, "end");
  if (srcStart === null || srcEnd === null || srcStart >= srcEnd) return null;

  const lineOffsets = computeLineOffsets(text);
  const startPos = sourceOffsetToLineCol(srcStart, lineOffsets);
  const endPos = sourceOffsetToLineCol(srcEnd, lineOffsets);
  // Guard: the refined range must overlap the initial anchor's line range.
  // Otherwise we picked up an unrelated occurrence elsewhere in the paper.
  if (startPos.line > initialAnchor.lineEnd || endPos.line < initialAnchor.lineStart) {
    return null;
  }

  const anchor: SourceAnchor2 = {
    kind: "source",
    file: initialAnchor.file,
    lineStart: startPos.line,
    colStart: startPos.col,
    lineEnd: endPos.line,
    colEnd: endPos.col,
  };
  const quote = text.slice(srcStart, srcEnd);
  if (quote.trim() === "") return null;
  const contextBefore = text.slice(Math.max(0, srcStart - CONTEXT_CHARS), srcStart);
  const contextAfter = text.slice(srcEnd, Math.min(text.length, srcEnd + CONTEXT_CHARS));
  return { anchor, quote, contextBefore, contextAfter };
}

export interface MarkdownSelection {
  anchor: SourceAnchor2;
  quote: string;
  contextBefore: string;
  contextAfter: string;
}

// Characters of surrounding paper text we lift into the context fields. Stays
// aligned with the bundle builder's ~200-char budget so the plugin-side
// re-anchoring heuristics see a familiar window.
const CONTEXT_CHARS = 200;

interface UseMarkdownSelectionOptions {
  containerRef: { current: HTMLElement | null };
  // Raw markdown source. The selection hook slices quote/context from this
  // so the emitted bundle carries source bytes (`**bold**`, backticks, etc.)
  // rather than rendered-DOM plain text. Passed explicitly (not read via a
  // closure) so a file switch doesn't force the hook to re-attach.
  text: string;
  onSelection: (selection: MarkdownSelection | null) => void;
  // Rising-edge callback: only fires when a new non-empty selection appears,
  // so opening the composer doesn't re-trigger on every mousemove.

  // Bumped by the adapter each time `MarkdownView` commits a new container
  // node (parse error/recovery, file switch). The mousedown listener must
  // re-attach on the new node, so this is in that effect's dep array.
  renderVersion?: number;
}

function textOfContainer(container: HTMLElement): string {
  // Serialise the container's plain text in depth-first order, matching the
  // walk that `selectionToSourceAnchor` uses for char offsets. This keeps
  // `contextBefore` / `contextAfter` aligned with the user's visual span.
  return container.innerText;
}

// Grabs the character offset of a Range endpoint relative to `container`'s
// plain-text serialization.
function offsetWithinContainer(container: HTMLElement, node: Node, nodeOffset: number): number {
  const range = document.createRange();
  range.setStart(container, 0);
  range.setEnd(node, nodeOffset);
  return range.toString().length;
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

// Browser selections whose endpoints cross block boundaries (drag from a
// heading into a paragraph, or into a list/table) may report `anchorNode` /
// `focusNode` on a container element rather than a text node, with `offset`
// as a child index. `selectionToSourceAnchor` walks UP looking for
// `data-src-file` — a container without that attribute fails. Descend to a
// real text node first so the walk-up lands on a per-block wrapper that
// carries the source position.
//
// Whitespace-only text children (hast-to-html injects "\n\n" between block
// tags during serialization) are skipped when descending: they live as
// direct children of wrappers like <ol> / <table> / <tbody> that don't
// carry `data-src-file`, so landing on them would fail the walk-up.
function isWhitespaceText(node: Node): boolean {
  return node.nodeType === TEXT_NODE && (node.nodeValue ?? "").trim() === "";
}

function quoteFromRange(
  container: HTMLElement,
  a: { node: Node; offset: number },
  b: { node: Node; offset: number },
): string {
  const doc = container.ownerDocument;
  if (!doc) return "";
  const range = doc.createRange();
  const forward =
    a.node === b.node
      ? a.offset <= b.offset
      : a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING;
  try {
    if (forward) {
      range.setStart(a.node, a.offset);
      range.setEnd(b.node, b.offset);
    } else {
      range.setStart(b.node, b.offset);
      range.setEnd(a.node, a.offset);
    }
  } catch {
    return "";
  }
  return range.toString().trim();
}

function normalizeEndpoint(node: Node, offset: number): { node: Node; offset: number } {
  if (node.nodeType === TEXT_NODE) return { node, offset };
  if (node.nodeType !== ELEMENT_NODE) return { node, offset };
  const el = node as HTMLElement;
  const childCount = el.childNodes.length;
  if (childCount === 0) return { node, offset };
  const idx = Math.min(Math.max(offset, 0), childCount);
  const atEnd = idx >= childCount;
  const step = atEnd ? -1 : 1;
  const startIdx = atEnd ? childCount - 1 : idx;
  for (let i = startIdx; i >= 0 && i < childCount; i += step) {
    const child = el.childNodes[i];
    if (!child) continue;
    if (isWhitespaceText(child)) continue;
    if (child.nodeType === TEXT_NODE) {
      return { node: child, offset: atEnd ? (child.nodeValue?.length ?? 0) : 0 };
    }
    if (child.nodeType === ELEMENT_NODE) {
      return normalizeEndpoint(child, atEnd ? child.childNodes.length : 0);
    }
  }
  return { node, offset };
}

// WebKit's cell-selection mode snaps `sel.anchorNode` to the start of the
// selected cell range — which means a drag that begins in the middle of a
// `<td>` is reported as starting at the top of the column. Work around that
// by capturing the caret at mousedown via `document.caretRangeFromPoint`
// (WebKit) / `caretPositionFromPoint` (standard) and using that as the
// source-of-truth anchor for the life of the selection.
export type CaretPoint = { node: Node; offset: number };

function caretAtPoint(doc: Document, x: number, y: number): CaretPoint | null {
  const d = doc as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (d.caretRangeFromPoint) {
    const range = d.caretRangeFromPoint(x, y);
    if (range) return { node: range.startContainer, offset: range.startOffset };
  }
  if (d.caretPositionFromPoint) {
    const pos = d.caretPositionFromPoint(x, y);
    if (pos) return { node: pos.offsetNode, offset: pos.offset };
  }
  return null;
}

// Pure wrapper around `caretAtPoint` that rejects element-node carets.
// An element-node caret typically means the click missed any text node (hit
// padding, a list marker, or a cell border). Returning null here lets the
// selectionchange handler fall back to the browser's native anchor, which
// tracks the drag correctly once the pointer crosses real text.
export function captureMousedownCaret(
  container: HTMLElement,
  x: number,
  y: number,
): CaretPoint | null {
  const doc = container.ownerDocument;
  if (!doc) return null;
  const caret = caretAtPoint(doc, x, y);
  if (caret && caret.node.nodeType === TEXT_NODE && container.contains(caret.node)) {
    return caret;
  }
  return null;
}

// WebKit snaps the native Selection's `anchorNode` the moment the drag
// crosses any block / inline boundary. Observed modes (from a live session
// in Tauri's WKWebView):
//
//   1. Anchor jumps to a block-level container element at some child index
//      (e.g. `<div class="md-view">` offset 10). `normalizeEndpoint` then
//      descends to child 0 and pins the anchor to the top of the block.
//   2. Anchor stays on a text node, but collapses to offset 0 of the
//      block's first text node. Same symptom, subtler signal.
//
// Use the mousedown cache when we can tell the native anchor is wrong:
//   - Native isn't a text node at all → clear WebKit snap (mode 1).
//   - Native IS a text node AND it's the same text node the mousedown
//     landed in → mousedown's offset is the exact click pixel from
//     `caretRangeFromPoint`, strictly more precise than whatever WebKit
//     currently reports (this catches mode 2: offset collapsed to 0).
//
// A native text anchor in a DIFFERENT text node than mousedown is left
// alone — that's how keyboard-driven (Cmd+A, Shift+Arrow) selections look,
// and their anchor shouldn't be overridden by a stale mouse click.
function shouldUseMousedown(
  anchorNode: Node,
  mousedown: CaretPoint | null,
  container: HTMLElement,
): boolean {
  if (mousedown === null) return false;
  if (!container.contains(mousedown.node)) return false;
  if (anchorNode.nodeType !== TEXT_NODE) return true;
  return anchorNode === mousedown.node;
}

export interface NativeSelectionSnapshot {
  anchorNode: Node | null;
  anchorOffset: number;
  focusNode: Node | null;
  focusOffset: number;
  isCollapsed: boolean;
  rangeCount: number;
}

// Pure resolver: given a container, the cached mousedown coords, and a snapshot
// of the browser's native selection, produce the `MarkdownSelection` the
// composer should render — or null if the selection doesn't anchor into any
// rendered block.
//
// Exported so tests can drive it directly without mounting a React tree; the
// hook below is a thin wiring layer on top of this.
export function computeMarkdownSelection(
  container: HTMLElement,
  mousedown: { x: number; y: number } | null,
  sel: NativeSelectionSnapshot,
  text?: string,
  pointer?: { x: number; y: number } | null,
): MarkdownSelection | null {
  if (sel.rangeCount === 0 || sel.isCollapsed) return null;
  const anchorNode = sel.anchorNode;
  const focusNode = sel.focusNode;
  if (!anchorNode || !focusNode) return null;
  if (!container.contains(anchorNode) || !container.contains(focusNode)) return null;

  // Re-resolve the mousedown coords against the *current* DOM on every call.
  // A snapshot captured at mousedown time can become detached when React
  // re-renders the inner HTML, breaking `container.contains(node)`.
  const freshCaret = mousedown ? captureMousedownCaret(container, mousedown.x, mousedown.y) : null;
  const useMouse = shouldUseMousedown(anchorNode, freshCaret, container);
  const anchorInput: CaretPoint = useMouse
    ? (freshCaret as CaretPoint)
    : { node: anchorNode, offset: sel.anchorOffset };
  // Focus-side snap mitigation. WebKit collapses `focusNode` to a container
  // element when a drag crosses inline boundaries (e.g. from a <strong> inside
  // a <li> across an inline <code> span); `normalizeEndpoint` would then
  // descend to that block's last text child and extend the anchor to the
  // entire bullet. Prefer the live pointer's caret when the native focus is
  // element-typed — that tracks where the user actually is.
  const focusInput: CaretPoint =
    focusNode.nodeType !== TEXT_NODE && pointer
      ? (captureMousedownCaret(container, pointer.x, pointer.y) ?? {
          node: focusNode,
          offset: sel.focusOffset,
        })
      : { node: focusNode, offset: sel.focusOffset };
  const normA = normalizeEndpoint(anchorInput.node, anchorInput.offset);
  const normF = normalizeEndpoint(focusInput.node, focusInput.offset);
  const anchor = selectionToSourceAnchor({
    anchorNode: normA.node,
    anchorOffset: normA.offset,
    focusNode: normF.node,
    focusOffset: normF.offset,
  });
  if (anchor === null) return null;

  const renderedQuote = quoteFromRange(container, normA, normF);

  if (text !== undefined && renderedQuote !== "") {
    // Preferred path: anchor.lineStart/lineEnd are accurate, but colStart/
    // colEnd came from `endpointToCoord` which conflates a block's *source*
    // col with its in-block *rendered* offset and so mis-aligns once the
    // selection crosses any markdown delimiter. Reanchor by finding the
    // rendered quote inside an mdast-walked view of the source; this yields
    // source-byte-accurate cols so the emitted slice starts at "Built", not
    // at the enclosing list marker's "-".
    const refined = refineAnchorWithRenderedQuote(text, anchor, renderedQuote);
    if (refined !== null) return refined;

    // Fallback: the old cols are likely imprecise but a source slice is still
    // preferable to rendered bytes — plan-fix's verifier does NFKC +
    // whitespace-collapse `.includes()` on the source line range, so the
    // bundle must carry source-formatted quote text.
    const sourceSpan = sliceSourceSpan(text, anchor);
    if (sourceSpan !== null) return { anchor, ...sourceSpan };
  }

  if (renderedQuote === "") return null;

  const full = textOfContainer(container);
  const startOffset = offsetWithinContainer(container, normA.node, normA.offset);
  const endOffset = offsetWithinContainer(container, normF.node, normF.offset);
  const [lo, hi] = startOffset <= endOffset ? [startOffset, endOffset] : [endOffset, startOffset];

  const contextBefore = full.slice(Math.max(0, lo - CONTEXT_CHARS), lo);
  const contextAfter = full.slice(hi, Math.min(full.length, hi + CONTEXT_CHARS));

  return { anchor, quote: renderedQuote, contextBefore, contextAfter };
}

export function useMarkdownSelection(options: UseMarkdownSelectionOptions): void {
  const { containerRef, onSelection, text } = options;
  // Keep `onSelection` in a ref so the listener closure below reads the latest
  // callback without our useEffect re-running on every parent render — if we
  // re-attached the listener on each render (the original bug), a fast drag
  // would race the swap: selectionchange events that fired while no listener
  // was attached got lost, pinning the composer to the first character.
  const onSelectionRef = useRef(onSelection);
  onSelectionRef.current = onSelection;
  // Same ref trick for source text: the selectionchange listener reads the
  // latest buffer without re-attaching on every keystroke in writer-mode
  // (where the buffer updates live from the CodeMirror editor).
  const textRef = useRef(text);
  textRef.current = text;
  const lastQuoteRef = useRef<string>("");
  const mousedownRef = useRef<{ x: number; y: number } | null>(null);
  // Live pointer position, updated on every pointermove during a drag.
  // `computeMarkdownSelection` consults it when WebKit snaps `focusNode` to a
  // container element mid-drag — the pointer tracks where the cursor actually
  // is, so we can land on a text-node caret instead of extending to the
  // block's last text child.
  const pointerRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    function onMousedown(ev: MouseEvent): void {
      mousedownRef.current = { x: ev.clientX, y: ev.clientY };
      pointerRef.current = { x: ev.clientX, y: ev.clientY };
    }
    function onMouseMove(ev: MouseEvent): void {
      // Only track while a button is held (a drag in progress). Without a
      // button-mask gate, idle mouse movement would fire thousands of
      // updates per minute for no benefit.
      if (ev.buttons === 0) return;
      pointerRef.current = { x: ev.clientX, y: ev.clientY };
    }
    function onMouseUp(ev: MouseEvent): void {
      pointerRef.current = { x: ev.clientX, y: ev.clientY };
    }
    container.addEventListener("mousedown", onMousedown, true);
    container.addEventListener("mousemove", onMouseMove, true);
    container.addEventListener("mouseup", onMouseUp, true);
    return () => {
      container.removeEventListener("mousedown", onMousedown, true);
      container.removeEventListener("mousemove", onMouseMove, true);
      container.removeEventListener("mouseup", onMouseUp, true);
    };
  }, [containerRef]);

  useEffect(() => {
    function onSelectionChange(): void {
      const container = containerRef.current;
      if (!container) return;
      const sel = document.getSelection();
      if (!sel) return;
      const result = computeMarkdownSelection(
        container,
        mousedownRef.current,
        {
          anchorNode: sel.anchorNode,
          anchorOffset: sel.anchorOffset,
          focusNode: sel.focusNode,
          focusOffset: sel.focusOffset,
          isCollapsed: sel.isCollapsed,
          rangeCount: sel.rangeCount,
        },
        textRef.current,
        pointerRef.current,
      );
      if (result === null) {
        if (lastQuoteRef.current !== "") {
          lastQuoteRef.current = "";
          onSelectionRef.current(null);
        }
        return;
      }
      if (result.quote === lastQuoteRef.current) return;
      lastQuoteRef.current = result.quote;
      onSelectionRef.current(result);
    }

    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [containerRef]);
}
