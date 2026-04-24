import type { SourceAnchorFields } from "@obelus/repo";

// Resolve a SourceAnchor to a DOM Range inside a rendered markdown container.
//
// The renderer stamps `data-src-file`, `data-src-line`, `data-src-end-line`,
// and `data-src-col` on every leaf block. A SourceAnchor's `colStart`/`colEnd`
// are source-file column offsets; subtracting the block's `data-src-col` gives
// an in-block text offset that's traversable against the rendered DOM.
//
// Blocks whose range spans multiple source lines (code fences, blockquotes)
// declare `data-src-end-line > data-src-line`; the overlap test below accepts
// them even when the anchor starts mid-block.

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

export function resolveSourceAnchorToRange(
  container: HTMLElement,
  anchor: SourceAnchorFields,
): Range | null {
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
): DOMRect[] {
  const range = resolveSourceAnchorToRange(container, anchor);
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
