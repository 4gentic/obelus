import type { FindProvider, FindSearchOptions } from "@obelus/review-shell";

// Geometry-only rects in scroll-container coordinates. The adapter paints
// these in the same `.review-shell__hl-layer` it already uses for annotation
// highlights, so find shares the existing overlay infra.
export interface FindRect {
  readonly key: string;
  readonly matchIndex: number;
  readonly current: boolean;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface FindHostHooks {
  // Returns the latest mounted container; called fresh on every search /
  // goto so we re-resolve after MarkdownView swaps inner DOM.
  getContainer(): HTMLElement | null;
  getScrollAncestor(container: HTMLElement): HTMLElement;
  // Replaces the painted rect set. An empty array clears the find layer
  // without touching annotation rects.
  paint(rects: ReadonlyArray<FindRect>): void;
  // Imperative scroll request — called after goto() so the active match is
  // brought into view. Top is in scroll-container coords (matches `paint`).
  scrollTo(top: number): void;
}

// One internal match: the resolved DOM Range plus the rects produced for it.
// We keep the Range so we can re-measure on layout/scroll bumps without
// re-walking text nodes.
interface InternalMatch {
  range: Range;
  rectCount: number;
}

const SKIP_TAGS: ReadonlySet<string> = new Set(["STYLE", "SCRIPT", "TEMPLATE", "NOSCRIPT"]);

interface TextIndex {
  text: string;
  // For position p in `text`, the text node it belongs to and the offset
  // inside that node's data. Built once per search.
  nodes: Text[];
  nodeStart: number[];
}

function buildTextIndex(root: HTMLElement): TextIndex {
  const nodes: Text[] = [];
  const nodeStart: number[] = [];
  const parts: string[] = [];
  let cursor = 0;
  const walker = root.ownerDocument?.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      let parent: Node | null = node.parentNode;
      while (parent && parent !== root) {
        if (parent.nodeType === 1 && SKIP_TAGS.has((parent as Element).tagName.toUpperCase())) {
          return NodeFilter.FILTER_REJECT;
        }
        parent = parent.parentNode;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  if (!walker) return { text: "", nodes, nodeStart };
  let n: Node | null = walker.nextNode();
  while (n) {
    const text = n as Text;
    if (text.data.length > 0) {
      nodes.push(text);
      nodeStart.push(cursor);
      parts.push(text.data);
      cursor += text.data.length;
    }
    n = walker.nextNode();
  }
  return { text: parts.join(""), nodes, nodeStart };
}

// Binary-search the (node, offset) for a flat-text position.
function locate(idx: TextIndex, pos: number): { node: Text; offset: number } | null {
  if (idx.nodes.length === 0) return null;
  let lo = 0;
  let hi = idx.nodes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    const start = idx.nodeStart[mid];
    if (start === undefined) break;
    if (start <= pos) lo = mid;
    else hi = mid - 1;
  }
  const node = idx.nodes[lo];
  const start = idx.nodeStart[lo];
  if (!node || start === undefined) return null;
  return { node, offset: Math.min(node.data.length, pos - start) };
}

function caseFold(s: string, caseSensitive: boolean): string {
  return caseSensitive ? s : s.toLocaleLowerCase();
}

function rectsFromRange(
  range: Range,
  scrollContainer: HTMLElement,
  matchIndex: number,
  current: boolean,
  outKeyOffset: number,
): FindRect[] {
  const scrollRect = scrollContainer.getBoundingClientRect();
  const out: FindRect[] = [];
  let i = 0;
  for (const r of range.getClientRects()) {
    if (r.width === 0 && r.height === 0) continue;
    out.push({
      key: `find-${matchIndex}-${outKeyOffset + i}`,
      matchIndex,
      current,
      left: r.left - scrollRect.left + scrollContainer.scrollLeft,
      top: r.top - scrollRect.top + scrollContainer.scrollTop,
      width: r.width,
      height: r.height,
    });
    i += 1;
  }
  return out;
}

// Provider augmented with adapter-only hooks. The find-store sees the
// FindProvider surface; the adapter calls `repaint()` on layout bumps and
// drops the cached ranges via `invalidate()` when the DOM has been rebuilt.
export interface MdFindProvider extends FindProvider {
  repaint(): void;
  invalidate(): void;
}

export function createMdFindProvider(hooks: FindHostHooks): MdFindProvider {
  let matches: InternalMatch[] = [];
  let currentIndex = -1;

  function repaint(): void {
    const container = hooks.getContainer();
    if (!container) {
      hooks.paint([]);
      return;
    }
    const scroll = hooks.getScrollAncestor(container);
    const out: FindRect[] = [];
    for (let i = 0; i < matches.length; i += 1) {
      const m = matches[i];
      if (!m) continue;
      const rects = rectsFromRange(m.range, scroll, i, i === currentIndex, 0);
      for (const r of rects) out.push(r);
    }
    hooks.paint(out);
  }

  return {
    async search(query: string, opts: FindSearchOptions): Promise<number> {
      matches = [];
      currentIndex = -1;
      const container = hooks.getContainer();
      if (!container || query.length === 0) {
        hooks.paint([]);
        return 0;
      }
      const idx = buildTextIndex(container);
      if (idx.text.length === 0) {
        hooks.paint([]);
        return 0;
      }
      const hay = caseFold(idx.text, opts.caseSensitive);
      const needle = caseFold(query, opts.caseSensitive);
      if (needle.length === 0) {
        hooks.paint([]);
        return 0;
      }
      const doc = container.ownerDocument;
      if (!doc) {
        hooks.paint([]);
        return 0;
      }
      let from = 0;
      while (from <= hay.length - needle.length) {
        if (opts.signal?.aborted) throw opts.signal.reason ?? new Error("search aborted");
        const hit = hay.indexOf(needle, from);
        if (hit < 0) break;
        const start = locate(idx, hit);
        const end = locate(idx, hit + needle.length);
        if (start && end) {
          const range = doc.createRange();
          try {
            range.setStart(start.node, start.offset);
            range.setEnd(end.node, end.offset);
            matches.push({ range, rectCount: 0 });
          } catch {
            // DOM rejected the boundary (rare; node was detached mid-walk).
            // Skip this match rather than aborting the whole search.
          }
        }
        from = hit + Math.max(1, needle.length);
      }
      currentIndex = matches.length > 0 ? 0 : -1;
      repaint();
      return matches.length;
    },
    goto(index: number): void {
      if (index < 0 || index >= matches.length) return;
      currentIndex = index;
      repaint();
      const m = matches[index];
      if (!m) return;
      const container = hooks.getContainer();
      if (!container) return;
      const scroll = hooks.getScrollAncestor(container);
      const rects = rectsFromRange(m.range, scroll, index, true, 0);
      const first = rects[0];
      if (first) hooks.scrollTo(Math.max(0, first.top - 100));
    },
    clear(): void {
      matches = [];
      currentIndex = -1;
      hooks.paint([]);
    },
    repaint,
    invalidate(): void {
      matches = [];
      currentIndex = -1;
      hooks.paint([]);
    },
  };
}
