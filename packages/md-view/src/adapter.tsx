import type { SourceAnchor2 } from "@obelus/bundle-schema";
import type { AnnotationRow, SourceAnchorFields } from "@obelus/repo";
import type { DocumentView } from "@obelus/review-shell";
import type { DraftInput, SourceDraftSlice } from "@obelus/review-store";
import type { JSX, ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { resolveSourceAnchorToRects } from "./highlights";
import { type MarkdownRenderStatus, MarkdownView, type MarkdownViewHandle } from "./MarkdownView";
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
  left: number;
  top: number;
  width: number;
  height: number;
};

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
}: Params): DocumentView {
  const viewRef = useRef<MarkdownViewHandle | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  const [renderVersion, setRenderVersion] = useState(0);
  const [, setLayoutTick] = useState(0);

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
    const scroll = container.closest<HTMLElement>(".review-shell__scroll");
    if (!scroll) return;
    const onScroll = (): void => setLayoutTick((t) => t + 1);
    scroll.addEventListener("scroll", onScroll, { passive: true });
    return () => scroll.removeEventListener("scroll", onScroll);
  }, [renderVersion]);

  const rectsForAnchor = useCallback((anchor: SourceAnchor2 | SourceAnchorFields): DOMRect[] => {
    const container = containerRef.current;
    if (!container) return [];
    const scroll = container.closest<HTMLElement>(".review-shell__scroll");
    if (!scroll) return [];
    return resolveSourceAnchorToRects(container, anchor, scroll);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: renderVersion is an intentional re-trigger so we recompute rects after MarkdownView re-parses — not an omitted dep of the function body.
  const annotationRects = useMemo<Map<string, DOMRect[]>>(() => {
    const out = new Map<string, DOMRect[]>();
    for (const row of annotations) {
      if (!row.sourceAnchor) continue;
      const rects = rectsForAnchor(row.sourceAnchor);
      if (rects.length > 0) out.set(row.id, rects);
    }
    return out;
  }, [annotations, rectsForAnchor, renderVersion]);

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
      const scroll = container?.closest<HTMLElement>(".review-shell__scroll");
      if (scroll && top !== undefined) {
        scroll.scrollTo({ top: Math.max(0, top - 100), behavior: "smooth" });
      }
    },
    [annotationTops],
  );

  const overlayRects = useMemo<HighlightRect[]>(() => {
    const out: HighlightRect[] = [];
    for (const row of annotations) {
      const rects = annotationRects.get(row.id);
      if (!rects) continue;
      for (const r of rects) {
        out.push({
          key: `ann-${row.id}-${r.left}-${r.top}`,
          category: row.category,
          draft: false,
          focused: focusedId === row.id,
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
            key: `draft-${r.left}-${r.top}`,
            category: draftCategory ?? "",
            draft: true,
            focused: false,
            left: r.left,
            top: r.top,
            width: r.width,
            height: r.height,
          });
        }
      }
    }
    return out;
  }, [annotations, annotationRects, selectedAnchor, draftCategory, focusedId, rectsForAnchor]);

  const content: ReactNode = (
    <div className="md-adapter">
      <MarkdownView ref={viewRef} file={file} text={text} onRender={onRender} />
      <HighlightLayer rects={overlayRects} />
    </div>
  );

  return {
    content,
    annotationTops,
    scrollToAnnotation,
    editable: false,
  };
}
