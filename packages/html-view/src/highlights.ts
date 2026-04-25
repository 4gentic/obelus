import type { HtmlAnchor2, SourceAnchor2 } from "@obelus/bundle-schema";

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

// Tags whose text content is part of the document's bytes but not its
// rendered prose. The anchor walks in `@obelus/anchor` skip the same set
// — both walks must agree, or character offsets shift between creation
// and resolution.
const SKIP_TAGS = new Set(["style", "script", "template", "noscript"]);

function isSkippableElement(node: Node): boolean {
  return node.nodeType === ELEMENT_NODE && SKIP_TAGS.has((node as Element).tagName.toLowerCase());
}

// Geometry-only view of either anchor variant. The adapter passes the saved
// anchor as-is regardless of which discriminant the persisted row carries.
export type HtmlMountAnchor = SourceAnchor2 | HtmlAnchor2;

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

function textNodeAtOffset(
  root: HTMLElement,
  target: number,
): { node: Text; offset: number } | null {
  if (target < 0) return null;
  let remaining = target;
  let last: Text | null = null;
  const walker = root.ownerDocument?.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      let parent: Node | null = node.parentNode;
      while (parent && parent !== root) {
        if (isSkippableElement(parent)) return NodeFilter.FILTER_REJECT;
        parent = parent.parentNode;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
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
  mount: HTMLElement,
  anchor: SourceAnchor2,
): Range | null {
  const blocks = Array.from(mount.querySelectorAll<HTMLElement>("[data-src-file]"));
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

  const doc = mount.ownerDocument;
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

// Mirrors `verifyHtmlAnchor`'s text walk: depth-first concatenation of every
// text node under `root`. We then translate the saved char offsets back into
// (text node, offset) pairs by walking the same way.
function findTextOffset(
  root: HTMLElement,
  charOffset: number,
): { node: Text; offset: number } | null {
  if (charOffset < 0) return null;
  let remaining = charOffset;
  let last: Text | null = null;
  const walk = (node: Node): { node: Text; offset: number } | null => {
    if (node.nodeType === TEXT_NODE) {
      const text = node as Text;
      last = text;
      const len = text.data.length;
      if (remaining <= len) return { node: text, offset: remaining };
      remaining -= len;
      return null;
    }
    if (node.nodeType === ELEMENT_NODE) {
      if (isSkippableElement(node)) return null;
      const el = node as HTMLElement;
      for (let i = 0; i < el.childNodes.length; i += 1) {
        const child = el.childNodes[i];
        if (!child) continue;
        const found = walk(child);
        if (found) return found;
      }
    }
    return null;
  };
  const found = walk(root);
  if (found) return found;
  if (last !== null) {
    const tail = last as Text;
    return { node: tail, offset: tail.data.length };
  }
  return null;
}

export function resolveHtmlAnchorToRange(mount: HTMLElement, anchor: HtmlAnchor2): Range | null {
  if (anchor.charOffsetStart > anchor.charOffsetEnd) return null;
  const start = findTextOffset(mount, anchor.charOffsetStart);
  const end = findTextOffset(mount, anchor.charOffsetEnd);
  if (!start || !end) return null;
  const doc = mount.ownerDocument;
  if (!doc) return null;
  const range = doc.createRange();
  try {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
  } catch {
    return null;
  }
  return range;
}

export function resolveAnchorToRange(mount: HTMLElement, anchor: HtmlMountAnchor): Range | null {
  if (anchor.kind === "source") return resolveSourceAnchorToRange(mount, anchor);
  if (anchor.kind === "html") return resolveHtmlAnchorToRange(mount, anchor);
  return null;
}

// `containerOffset` translates iframe-viewport-relative rects into the
// parent document's coordinate space. When the mount lives in the same
// document as the scroll container (legacy light-DOM path, or md/pdf
// papers), pass `{ left: 0, top: 0 }` or omit the argument.
export function resolveAnchorToRects(
  mount: HTMLElement,
  anchor: HtmlMountAnchor,
  scrollContainer: HTMLElement,
  containerOffset: { left: number; top: number } = { left: 0, top: 0 },
): DOMRect[] {
  const range = resolveAnchorToRange(mount, anchor);
  if (!range) return [];
  const scrollRect = scrollContainer.getBoundingClientRect();
  const out: DOMRect[] = [];
  for (const r of range.getClientRects()) {
    out.push(
      new DOMRect(
        r.left + containerOffset.left - scrollRect.left + scrollContainer.scrollLeft,
        r.top + containerOffset.top - scrollRect.top + scrollContainer.scrollTop,
        r.width,
        r.height,
      ),
    );
  }
  return out;
}
