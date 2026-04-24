import type { SourceAnchorFields } from "@obelus/repo";
import {
  type DocumentSourceMap,
  computeLineOffsets,
  lineColToSourceOffset,
  mapSourceToRendered,
} from "./source-map";

// Resolve a SourceAnchor to a DOM Range inside a rendered markdown container.
//
// The renderer stamps `data-src-file`, `data-src-line`, `data-src-end-line`,
// and `data-src-col` on every leaf block. A SourceAnchor's `colStart`/`colEnd`
// are source-file column offsets. To paint a highlight we translate those
// source cols into RENDERED-DOM offsets — naive subtraction of the block's
// `data-src-col` is wrong as soon as a markdown delimiter (`**`, backticks,
// `[text](url)`) sits between the block start and the user's selection. With
// a document-wide mdast offset map, source cols round-trip through the same
// math the selection-side refinement uses, so highlight rects line up with
// what the user originally dragged.

const TEXT_NODE = 3;

type Found = { node: Text; offset: number };

function readIntAttr(el: HTMLElement, name: string): number | null {
  const raw = el.getAttribute(name);
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) ? null : n;
}

function blockCoversLine(block: HTMLElement, line: number): boolean {
  const start = readIntAttr(block, "data-src-line");
  if (start === null) return false;
  const end = readIntAttr(block, "data-src-end-line") ?? start;
  return line >= start && line <= end;
}

function blockForLine(
  blocks: ReadonlyArray<HTMLElement>,
  file: string,
  line: number,
): HTMLElement | null {
  for (const b of blocks) {
    if (b.getAttribute("data-src-file") !== file) continue;
    if (blockCoversLine(b, line)) return b;
  }
  return null;
}

// Walk text nodes in depth-first order and return the (node, offset) pair
// corresponding to `target` code units from the start of `root`. Clamps to
// the end of the last text node if the offset overruns — markdown rendering
// can drop whitespace that the source-column counts, so a slight overrun is
// normal and we'd rather land at the end of the block than return null.
export function textNodeAtOffset(root: HTMLElement, target: number): Found | null {
  if (target < 0) return null;
  let remaining = target;
  let last: Text | null = null;
  const walker = root.ownerDocument?.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  if (!walker) return null;
  let n: Node | null = walker.nextNode();
  while (n) {
    if (n.nodeType === TEXT_NODE) {
      const text = n as Text;
      last = text;
      const len = text.data.length;
      if (remaining <= len) return { node: text, offset: remaining };
      remaining -= len;
    }
    n = walker.nextNode();
  }
  if (last) return { node: last, offset: last.data.length };
  return null;
}

// Tags that hast-util-to-html / mdast-util-to-hast pad with whitespace text
// nodes between block-level children (`<ul>\n<li>…</li>\n</ul>`). Walking
// text descendants of these tags would count the inter-block whitespace
// against rendered offsets and drift past the mdast walk by one char per
// boundary. Skipping whitespace-only text whose parent is one of these tags
// keeps the doc-wide DOM walk in lockstep with mdast text concatenation.
const STRUCTURAL_PARENT_TAGS: ReadonlySet<string> = new Set([
  "UL",
  "OL",
  "BLOCKQUOTE",
  "TABLE",
  "THEAD",
  "TBODY",
  "TFOOT",
  "TR",
  "DIV",
  "ARTICLE",
  "SECTION",
  "BODY",
  "HTML",
]);

function shouldCountTextNode(text: Text): boolean {
  // Real content always has at least one non-whitespace char; cheap predicate
  // first so the structural-parent lookup only fires on whitespace runs.
  if (/\S/.test(text.data)) return true;
  const parent = text.parentElement;
  if (!parent) return true;
  return !STRUCTURAL_PARENT_TAGS.has(parent.tagName);
}

// Walks `root`'s text descendants in DFS document order and returns the
// (node, offset) pair at the requested rendered-offset target. The walk is
// designed to match what `buildDocumentSourceMap` produces from the same
// source: real content text in source order, with no inter-block whitespace.
// `hast-util-to-html` injects newline text nodes between block siblings;
// `shouldCountTextNode` skips them from the counting walk, but a Range
// endpoint pinned at one counted node's end and another's start still spans
// those skipped whitespace nodes (`range.toString()` walks the DOM, not our
// filtered view). Bias disambiguates the boundary: a `start` endpoint at a
// counted-node boundary snaps forward to the next node's offset 0, so the
// range body begins past the inter-block "\n"; an `end` endpoint stays at
// the previous node's end so its tail doesn't include a leading whitespace.
function textNodeInDocument(
  root: HTMLElement,
  target: number,
  bias: "start" | "end",
): Found | null {
  if (target < 0) return null;
  let remaining = target;
  let last: Text | null = null;
  const walker = root.ownerDocument?.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      shouldCountTextNode(node as Text) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  });
  if (!walker) return null;
  let n: Node | null = walker.nextNode();
  while (n) {
    if (n.nodeType === TEXT_NODE) {
      const text = n as Text;
      last = text;
      const len = text.data.length;
      const match = bias === "start" ? remaining < len : remaining <= len;
      if (match) return { node: text, offset: remaining };
      remaining -= len;
    }
    n = walker.nextNode();
  }
  if (last) return { node: last, offset: last.data.length };
  return null;
}

export function resolveSourceAnchorToRange(
  container: HTMLElement,
  anchor: SourceAnchorFields,
  sourceMap: DocumentSourceMap | null,
  sourceText: string | null,
): Range | null {
  // Preferred path: mdast-derived map gives us a source-col → rendered-offset
  // translation that respects markdown delimiters. Walk the doc-wide DOM
  // text in lockstep with the breakpoint walk so rendered offsets agree.
  if (sourceMap !== null && sourceText !== null) {
    const lineOffsets = computeLineOffsets(sourceText);
    const startSrc = lineColToSourceOffset(anchor.lineStart, anchor.colStart, lineOffsets);
    const endSrc = lineColToSourceOffset(anchor.lineEnd, anchor.colEnd, lineOffsets);
    if (startSrc !== null && endSrc !== null && startSrc <= endSrc) {
      const startRendered = mapSourceToRendered(sourceMap.breakpoints, startSrc, "start");
      const endRendered = mapSourceToRendered(sourceMap.breakpoints, endSrc, "end");
      if (
        startRendered !== null &&
        endRendered !== null &&
        startRendered <= endRendered &&
        endRendered <= sourceMap.rendered.length
      ) {
        const startTarget = textNodeInDocument(container, startRendered, "start");
        const endTarget = textNodeInDocument(container, endRendered, "end");
        if (startTarget && endTarget) {
          const range = container.ownerDocument?.createRange();
          if (!range) return null;
          try {
            range.setStart(startTarget.node, startTarget.offset);
            range.setEnd(endTarget.node, endTarget.offset);
            return range;
          } catch {
            // Fall through to the legacy block-local path below.
          }
        }
      }
    }
  }

  // Legacy fallback: walk block-locally with naive source-col arithmetic.
  // Produces the wrong rects when the anchor crosses inline markdown
  // delimiters, but matches the pre-source-map behaviour for cases where
  // the map can't be built (parse failure, text out of sync with DOM).
  const blocks = Array.from(container.querySelectorAll<HTMLElement>("[data-src-file]"));
  const startBlock = blockForLine(blocks, anchor.file, anchor.lineStart);
  const endBlock = blockForLine(blocks, anchor.file, anchor.lineEnd);
  if (!startBlock || !endBlock) return null;

  const startBlockCol = readIntAttr(startBlock, "data-src-col") ?? 0;
  const endBlockCol = readIntAttr(endBlock, "data-src-col") ?? 0;

  const startInBlock = Math.max(0, anchor.colStart - startBlockCol);
  const endInBlock = Math.max(0, anchor.colEnd - endBlockCol);

  const startTarget = textNodeAtOffset(startBlock, startInBlock);
  const endTarget = textNodeAtOffset(endBlock, endInBlock);
  if (!startTarget || !endTarget) return null;

  const doc = container.ownerDocument;
  if (!doc) return null;
  const range = doc.createRange();
  try {
    range.setStart(startTarget.node, startTarget.offset);
    range.setEnd(endTarget.node, endTarget.offset);
  } catch {
    return null;
  }
  return range;
}

// Scroll-container-relative rects for a saved SourceAnchor. Used for both
// highlight painting and margin-note Y alignment. An empty array signals
// "not paintable yet" — the caller typically leaves the mark out of the
// gutter until the next layout pass.
export function resolveSourceAnchorToRects(
  container: HTMLElement,
  anchor: SourceAnchorFields,
  scrollContainer: HTMLElement,
  sourceMap: DocumentSourceMap | null,
  sourceText: string | null,
): DOMRect[] {
  const range = resolveSourceAnchorToRange(container, anchor, sourceMap, sourceText);
  if (!range) return [];
  const scrollRect = scrollContainer.getBoundingClientRect();
  const out: DOMRect[] = [];
  for (const r of range.getClientRects()) {
    out.push(
      new DOMRect(
        r.left - scrollRect.left + scrollContainer.scrollLeft,
        r.top - scrollRect.top + scrollContainer.scrollTop,
        r.width,
        r.height,
      ),
    );
  }
  return out;
}
