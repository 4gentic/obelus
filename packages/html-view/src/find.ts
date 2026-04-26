import type { FindProvider, FindSearchOptions } from "@obelus/review-shell";

// Geometry-only rects in scroll-container coordinates. The HTML adapter paints
// these in a sibling layer alongside the existing annotation HighlightLayer.
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
  // The mount node owning paper text — the iframe's `<body>` in production.
  // Resolved fresh on each call so we re-walk after srcdoc swaps.
  getMount(): HTMLElement | null;
  // The iframe element when the mount is inside one; `null` for legacy
  // light-DOM mounts. Used to translate iframe-viewport rects into the
  // parent scroll-container's coord space.
  getFrame(): HTMLIFrameElement | null;
  // The host (parent-document) element used for scroll-container math.
  getHost(): HTMLElement | null;
  getScrollAncestor(host: HTMLElement): HTMLElement;
  paint(rects: ReadonlyArray<FindRect>): void;
  // Imperative scroll inside the iframe (since iframe content owns its own
  // scroll). `top` is iframe-document coords. The host falls back to
  // `scrollIntoView` when iframe scroll isn't available.
  scrollMatchIntoView(range: Range): void;
}

interface InternalMatch {
  range: Range;
}

const TEXT_NODE = 3;
const SKIP_TAGS: ReadonlySet<string> = new Set(["STYLE", "SCRIPT", "TEMPLATE", "NOSCRIPT"]);

interface TextIndex {
  text: string;
  nodes: Text[];
  nodeStart: number[];
}

function buildTextIndex(root: HTMLElement): TextIndex {
  const nodes: Text[] = [];
  const nodeStart: number[] = [];
  const parts: string[] = [];
  let cursor = 0;
  const doc = root.ownerDocument;
  if (!doc) return { text: "", nodes, nodeStart };
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
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
  let n: Node | null = walker.nextNode();
  while (n) {
    if (n.nodeType === TEXT_NODE) {
      const text = n as Text;
      if (text.data.length > 0) {
        nodes.push(text);
        nodeStart.push(cursor);
        parts.push(text.data);
        cursor += text.data.length;
      }
    }
    n = walker.nextNode();
  }
  return { text: parts.join(""), nodes, nodeStart };
}

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

function projectRects(
  range: Range,
  scrollContainer: HTMLElement,
  frame: HTMLIFrameElement | null,
  matchIndex: number,
  current: boolean,
): FindRect[] {
  const scrollRect = scrollContainer.getBoundingClientRect();
  const frameRect = frame?.getBoundingClientRect() ?? { left: 0, top: 0 };
  const out: FindRect[] = [];
  let i = 0;
  for (const r of range.getClientRects()) {
    if (r.width === 0 && r.height === 0) continue;
    out.push({
      key: `find-${matchIndex}-${i}`,
      matchIndex,
      current,
      left: r.left + frameRect.left - scrollRect.left + scrollContainer.scrollLeft,
      top: r.top + frameRect.top - scrollRect.top + scrollContainer.scrollTop,
      width: r.width,
      height: r.height,
    });
    i += 1;
  }
  return out;
}

export interface HtmlFindProvider extends FindProvider {
  repaint(): void;
  invalidate(): void;
}

export function createHtmlFindProvider(hooks: FindHostHooks): HtmlFindProvider {
  let matches: InternalMatch[] = [];
  let currentIndex = -1;

  function repaint(): void {
    const host = hooks.getHost();
    if (!host) {
      hooks.paint([]);
      return;
    }
    const scroll = hooks.getScrollAncestor(host);
    const frame = hooks.getFrame();
    const out: FindRect[] = [];
    for (let i = 0; i < matches.length; i += 1) {
      const m = matches[i];
      if (!m) continue;
      const rects = projectRects(m.range, scroll, frame, i, i === currentIndex);
      for (const r of rects) out.push(r);
    }
    hooks.paint(out);
  }

  return {
    async search(query: string, opts: FindSearchOptions): Promise<number> {
      matches = [];
      currentIndex = -1;
      const mount = hooks.getMount();
      if (!mount || query.length === 0) {
        hooks.paint([]);
        return 0;
      }
      const idx = buildTextIndex(mount);
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
      const doc = mount.ownerDocument;
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
            matches.push({ range });
          } catch {
            // Detached node — skip.
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
      if (m) hooks.scrollMatchIntoView(m.range);
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
