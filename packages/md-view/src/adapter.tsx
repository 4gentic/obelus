import type { AnnotationRow, SourceAnchorFields } from "@obelus/repo";
import type { DocumentView } from "@obelus/review-shell";
import type { DraftInput, SourceDraftSlice } from "@obelus/review-store";
import type { JSX, ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createMdFindProvider, type FindRect } from "./find";
import { resolveSourceAnchorToRects } from "./highlights";
import {
  type MarkdownExternalBlocked,
  type MarkdownRenderStatus,
  MarkdownView,
  type MarkdownViewHandle,
} from "./MarkdownView";
import { buildDocumentSourceMap, type DocumentSourceMap } from "./source-map";
import { type MarkdownSelection, useMarkdownSelection } from "./use-md-selection";

type Params = {
  file: string;
  text: string;
  annotations: ReadonlyArray<AnnotationRow>;
  selectedAnchor: DraftInput | null;
  draftCategory: string | null;
  focusedId: string | null;
  onAnchor: (draft: DraftInput) => void;
  onRenderError?: (message: string | null) => void;
  // When true, external `<img>` / `<source>` URLs in the rendered output
  // are passed through to the browser. When false (the default), they're
  // pre-rewritten to a placeholder before they reach the DOM and fired
  // through `onExternalBlocked`.
  trusted?: boolean;
  onExternalBlocked?: (event: MarkdownExternalBlocked) => void;
};

function toSourceSlice(sel: MarkdownSelection): SourceDraftSlice {
  return {
    kind: "source",
    anchor: sel.anchor,
    quote: sel.quote,
    contextBefore: sel.contextBefore,
    contextAfter: sel.contextAfter,
  };
}

type HighlightRect = {
  key: string;
  category: string;
  draft: boolean;
  focused: boolean;
  stale: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
};

// Walk up from the md container to the first scrollable ancestor, falling
// back to the document's scrolling element. The adapter is mounted both
// inside `.review-shell__scroll` (web `ReviewShell`) and inside
// `.md-pane { overflow: auto }` (desktop `MdReviewSurface`), so hard-coding
// a wrapper class misses one surface and silently breaks scroll-relative
// coordinates.
function findScrollAncestor(el: HTMLElement): HTMLElement {
  let cur: HTMLElement | null = el.parentElement;
  while (cur) {
    const style = cur.ownerDocument?.defaultView?.getComputedStyle(cur);
    const overflow = (style?.overflowY ?? "") + (style?.overflowX ?? "");
    if (/(auto|scroll|overlay)/.test(overflow)) return cur;
    cur = cur.parentElement;
  }
  return (
    (el.ownerDocument?.scrollingElement as HTMLElement | null) ??
    el.ownerDocument?.documentElement ??
    el
  );
}

// Paints absolute rects inside `.review-shell__hl-layer` (provided by the
// adapter). Coordinates are scroll-container-relative — same convention as
// the PDF adapter — so the shell's overlay positioning stays uniform.
function HighlightLayer({ rects }: { rects: ReadonlyArray<HighlightRect> }): JSX.Element {
  return (
    <div className="review-shell__hl-layer" aria-hidden="true">
      {rects.map((r) => (
        <div
          key={r.key}
          className={r.draft ? "review-shell__hl review-shell__hl--draft" : "review-shell__hl"}
          data-category={r.category}
          data-focused={r.focused ? "true" : undefined}
          data-stale={r.stale ? "true" : undefined}
          style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
        />
      ))}
    </div>
  );
}

// Sibling layer for find matches. Kept distinct from `HighlightLayer` so the
// styling cascade for annotations vs. find is not coupled — find rects use a
// neutral yellow fill and a stronger ring on the active match.
function FindLayer({ rects }: { rects: ReadonlyArray<FindRect> }): JSX.Element {
  return (
    <div className="review-shell__hl-layer review-shell__hl-layer--find" aria-hidden="true">
      {rects.map((r) => (
        <div
          key={r.key}
          className={
            r.current
              ? "review-shell__hl review-shell__hl--find review-shell__hl--find-current"
              : "review-shell__hl review-shell__hl--find"
          }
          style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
        />
      ))}
    </div>
  );
}

export function useMdDocumentView({
  file,
  text,
  annotations,
  selectedAnchor,
  draftCategory,
  focusedId,
  onAnchor,
  onRenderError,
  trusted = false,
  onExternalBlocked,
}: Params): DocumentView {
  const viewRef = useRef<MarkdownViewHandle | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  const [renderVersion, setRenderVersion] = useState(0);
  const [layoutTick, setLayoutTick] = useState(0);

  const onRender = useCallback(
    (status: MarkdownRenderStatus) => {
      const container = viewRef.current?.getContainer() ?? null;
      containerRef.current = container;
      setRenderVersion((v) => v + 1);
      onRenderError?.(status.kind === "parse-failed" ? status.error.kind : null);
    },
    [onRenderError],
  );

  useMarkdownSelection({
    containerRef,
    text,
    renderVersion,
    onSelection: (sel) => {
      if (sel === null) return;
      onAnchor({
        slices: [toSourceSlice(sel)],
        quote: sel.quote,
        contextBefore: sel.contextBefore,
        contextAfter: sel.contextAfter,
      });
    },
  });

  // Observe the container so text reflow / window resize / font swap bump
  // the layout tick. Margin notes re-measure on every tick. `renderVersion`
  // is listed so we re-attach the observer after MarkdownView rerenders and
  // swaps out the container node.
  // biome-ignore lint/correctness/useExhaustiveDependencies: containerRef is a ref; renderVersion intentionally drives re-attach.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setLayoutTick((t) => t + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, [renderVersion]);

  // Scroll-container scroll also shifts anchor coordinates in our frame of
  // reference when we combine scroll{Top,Left} into the rects. Tick on every
  // scroll so margin notes stay glued to their lines — throttling would
  // cause visible drift.
  // biome-ignore lint/correctness/useExhaustiveDependencies: containerRef is a ref; renderVersion intentionally drives re-lookup of the scroll ancestor.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scroll = findScrollAncestor(container);
    const onScroll = (): void => setLayoutTick((t) => t + 1);
    scroll.addEventListener("scroll", onScroll, { passive: true });
    return () => scroll.removeEventListener("scroll", onScroll);
  }, [renderVersion]);

  // Memoised mdast offset map for the current source. Used by the highlight
  // resolver to translate `SourceAnchor` cols (now source-byte-accurate after
  // the selection-side refinement) into rendered DOM offsets that line up
  // with the same text the user dragged. Built once per text change.
  const sourceMap = useMemo<DocumentSourceMap | null>(() => buildDocumentSourceMap(text), [text]);

  const rectsForAnchor = useCallback(
    (anchor: SourceAnchorFields): DOMRect[] => {
      const container = containerRef.current;
      if (!container) return [];
      return resolveSourceAnchorToRects(
        container,
        anchor,
        findScrollAncestor(container),
        sourceMap,
        text,
      );
    },
    [sourceMap, text],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: renderVersion and layoutTick are intentional re-triggers so we recompute rects after MarkdownView re-parses or after a ResizeObserver / scroll tick — not omitted deps of the function body.
  const annotationRects = useMemo<Map<string, DOMRect[]>>(() => {
    const out = new Map<string, DOMRect[]>();
    for (const row of annotations) {
      if (row.anchor.kind !== "source") continue;
      const rects = rectsForAnchor(row.anchor);
      if (rects.length > 0) out.set(row.id, rects);
    }
    return out;
  }, [annotations, rectsForAnchor, renderVersion, layoutTick]);

  const annotationTops = useMemo<Map<string, number>>(() => {
    const out = new Map<string, number>();
    for (const [id, rects] of annotationRects) {
      const first = rects[0];
      if (first) out.set(id, first.top);
    }
    return out;
  }, [annotationRects]);

  const scrollToAnnotation = useCallback(
    (id: string): void => {
      const top = annotationTops.get(id);
      const container = containerRef.current;
      if (container && top !== undefined) {
        findScrollAncestor(container).scrollTo({
          top: Math.max(0, top - 100),
          behavior: "smooth",
        });
      }
    },
    [annotationTops],
  );

  const [findRects, setFindRects] = useState<ReadonlyArray<FindRect>>([]);
  const find = useMemo(
    () =>
      createMdFindProvider({
        getContainer: () => containerRef.current,
        getScrollAncestor: (el) => findScrollAncestor(el),
        paint: (rects) => setFindRects(rects),
        scrollTo: (top) => {
          const container = containerRef.current;
          if (!container) return;
          findScrollAncestor(container).scrollTo({ top, behavior: "smooth" });
        },
      }),
    [],
  );

  // On layout shifts (resize / scroll bumps), the cached Ranges are still
  // valid but the rect projections drift — re-paint from the same matches.
  // biome-ignore lint/correctness/useExhaustiveDependencies: layoutTick is an intentional re-fire trigger; the body reads it implicitly through the latest scroll-container geometry.
  useEffect(() => {
    find.repaint();
  }, [layoutTick, find]);

  // On a full DOM rebuild (renderVersion bump), the cached Range objects
  // reference detached nodes — drop them so a stale find layer doesn't
  // linger. The host re-runs search on the next setQuery / setProvider call.
  useEffect(() => {
    if (renderVersion === 0) return;
    find.invalidate();
  }, [renderVersion, find]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: layoutTick is an intentional re-trigger so draft rects refresh on ResizeObserver / scroll bumps even when no other dep changed — without it the dashed-outline draft layer stays painted at pre-resize coords.
  const overlayRects = useMemo<HighlightRect[]>(() => {
    const out: HighlightRect[] = [];
    let rectIndex = 0;
    for (const row of annotations) {
      const rects = annotationRects.get(row.id);
      if (!rects) continue;
      const stale = row.staleness !== undefined && row.staleness !== "ok";
      for (const r of rects) {
        // The (left, top) pair isn't unique on its own — a Range spanning two
        // visual lines can produce rects whose origins land at the same
        // pixel coords after scroll-container math. Including a monotonic
        // index keeps React's reconciler from leaking phantom highlights
        // when the source rect set changes shape (the bug we paid for in
        // the form of orphan dashed rects that wouldn't dismiss on Esc).
        out.push({
          key: `ann-${row.id}-${rectIndex++}`,
          category: row.category,
          draft: false,
          focused: focusedId === row.id,
          stale,
          left: r.left,
          top: r.top,
          width: r.width,
          height: r.height,
        });
      }
    }
    if (selectedAnchor) {
      for (const slice of selectedAnchor.slices) {
        if (slice.kind !== "source") continue;
        for (const r of rectsForAnchor(slice.anchor)) {
          out.push({
            key: `draft-${rectIndex++}`,
            category: draftCategory ?? "",
            draft: true,
            focused: false,
            stale: false,
            left: r.left,
            top: r.top,
            width: r.width,
            height: r.height,
          });
        }
      }
    }
    return out;
  }, [
    annotations,
    annotationRects,
    selectedAnchor,
    draftCategory,
    focusedId,
    rectsForAnchor,
    layoutTick,
  ]);

  const content: ReactNode = (
    <div className="md-adapter">
      <MarkdownView
        ref={viewRef}
        file={file}
        text={text}
        onRender={onRender}
        trusted={trusted}
        {...(onExternalBlocked !== undefined ? { onExternalBlocked } : {})}
      />
      <HighlightLayer rects={overlayRects} />
      <FindLayer rects={findRects} />
    </div>
  );

  return {
    content,
    annotationTops,
    scrollToAnnotation,
    editable: false,
    find,
  };
}
