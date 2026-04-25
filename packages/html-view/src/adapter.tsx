import type { AnnotationRow, AnnotationStaleness } from "@obelus/repo";
import type { DocumentView } from "@obelus/review-shell";
import type { DraftInput, HtmlDraftSlice, SourceDraftSlice } from "@obelus/review-store";
import type { AssetResolver } from "@obelus/source-render/browser";
import type { JSX, ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { HtmlView, type HtmlViewHandle } from "./HtmlView";
import { type HtmlMountAnchor, resolveAnchorToRects } from "./highlights";
import { type HtmlSelectionAnchor, useHtmlSelection } from "./use-html-selection";

// `AnnotationRow.anchor` will widen to include the html arm when the schema
// task lands; until then, the adapter accepts a structurally-compatible row
// shape that already permits html anchors so callers can use it from day one.
type HtmlAnnotationRow = Omit<AnnotationRow, "anchor"> & {
  anchor: HtmlMountAnchor | AnnotationRow["anchor"];
};

type Params = {
  file: string;
  html: string;
  mode: "source" | "html";
  sourceFile?: string;
  assets?: AssetResolver;
  annotations: ReadonlyArray<HtmlAnnotationRow>;
  selectedAnchor: DraftInput | null;
  draftCategory: string | null;
  focusedId: string | null;
  onAnchor: (draft: DraftInput) => void;
};

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

function isSupportedAnchor(anchor: unknown): anchor is HtmlMountAnchor {
  if (typeof anchor !== "object" || anchor === null) return false;
  const kind = (anchor as { kind?: unknown }).kind;
  return kind === "source" || kind === "html";
}

function sourceSliceFromSource(sel: HtmlSelectionAnchor & { kind: "source" }): SourceDraftSlice {
  return {
    kind: "source",
    anchor: sel.anchor,
    quote: sel.quote,
    contextBefore: sel.contextBefore,
    contextAfter: sel.contextAfter,
  };
}

// When the html-view ran in "source" mode and the captured selection carries
// a sourceHint, dispatch as a SourceDraftSlice so the underlying source file
// becomes the system of record. Otherwise emit an HtmlDraftSlice — the html
// arm of the bundle's anchor union.
function htmlSliceFor(
  sel: HtmlSelectionAnchor & { kind: "html" },
): SourceDraftSlice | HtmlDraftSlice {
  const hint = sel.anchor.sourceHint;
  if (hint) {
    return {
      kind: "source",
      anchor: hint,
      quote: sel.quote,
      contextBefore: sel.contextBefore,
      contextAfter: sel.contextAfter,
    };
  }
  return {
    kind: "html",
    anchor: sel.anchor,
    quote: sel.quote,
    contextBefore: sel.contextBefore,
    contextAfter: sel.contextAfter,
  };
}

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

export function useHtmlDocumentView(params: Params): DocumentView {
  const {
    file,
    html,
    mode,
    sourceFile,
    assets,
    annotations,
    selectedAnchor,
    draftCategory,
    focusedId,
    onAnchor,
  } = params;
  const viewRef = useRef<HtmlViewHandle | null>(null);
  const hostRef = useRef<HTMLElement | null>(null);
  const mountRef = useRef<HTMLElement | null>(null);
  const [renderVersion, setRenderVersion] = useState(0);
  const [layoutTick, setLayoutTick] = useState(0);

  // After each render, re-snapshot the host + mount handles. The handles
  // change identity on remount but stay stable across re-paints, so a single
  // `renderVersion` bump per html change is enough to keep refs current.
  useEffect(() => {
    hostRef.current = viewRef.current?.getHost() ?? null;
    mountRef.current = viewRef.current?.getShadowMount() ?? null;
    setRenderVersion((v) => v + 1);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: html/file are intentional re-triggers — when either changes the inner shadow mount swaps and the cached refs need to be re-snapshotted.
  useEffect(() => {
    hostRef.current = viewRef.current?.getHost() ?? null;
    mountRef.current = viewRef.current?.getShadowMount() ?? null;
    setRenderVersion((v) => v + 1);
  }, [html, file]);

  useHtmlSelection({
    hostRef,
    mountRef,
    file,
    mode,
    ...(sourceFile !== undefined ? { sourceFile } : {}),
    onSelection: (sel) => {
      if (sel === null) return;
      if (sel.kind === "source") {
        const slice = sourceSliceFromSource(sel);
        onAnchor({
          slices: [slice],
          quote: sel.quote,
          contextBefore: sel.contextBefore,
          contextAfter: sel.contextAfter,
        });
        return;
      }
      const slice = htmlSliceFor(sel);
      onAnchor({
        slices: [slice],
        quote: sel.quote,
        contextBefore: sel.contextBefore,
        contextAfter: sel.contextAfter,
      });
    },
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: hostRef is a ref; renderVersion drives re-attach when the host node swaps.
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setLayoutTick((t) => t + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, [renderVersion]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: hostRef is a ref; renderVersion drives re-lookup of the scroll ancestor.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const scroll = findScrollAncestor(host);
    const onScroll = (): void => setLayoutTick((t) => t + 1);
    scroll.addEventListener("scroll", onScroll, { passive: true });
    return () => scroll.removeEventListener("scroll", onScroll);
  }, [renderVersion]);

  const rectsForAnchor = useCallback((anchor: HtmlMountAnchor): DOMRect[] => {
    const mount = mountRef.current;
    const host = hostRef.current;
    if (!mount || !host) return [];
    return resolveAnchorToRects(mount, anchor, findScrollAncestor(host));
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: renderVersion + layoutTick are intentional re-triggers.
  const annotationRects = useMemo<Map<string, DOMRect[]>>(() => {
    const out = new Map<string, DOMRect[]>();
    for (const row of annotations) {
      if (!isSupportedAnchor(row.anchor)) continue;
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
      const host = hostRef.current;
      if (host && top !== undefined) {
        findScrollAncestor(host).scrollTo({
          top: Math.max(0, top - 100),
          behavior: "smooth",
        });
      }
    },
    [annotationTops],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: layoutTick re-triggers the draft overlay even when no other dep changed.
  const overlayRects = useMemo<HighlightRect[]>(() => {
    const out: HighlightRect[] = [];
    let rectIndex = 0;
    for (const row of annotations) {
      const rects = annotationRects.get(row.id);
      if (!rects) continue;
      const stale = isStale(row.staleness);
      for (const r of rects) {
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
        if (slice.kind !== "source" && slice.kind !== "html") continue;
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
    <div className="html-adapter">
      <HtmlView
        ref={viewRef}
        file={file}
        html={html}
        mode={mode}
        {...(sourceFile !== undefined ? { sourceFile } : {})}
        {...(assets !== undefined ? { assets } : {})}
      />
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

function isStale(s: AnnotationStaleness | undefined): boolean {
  return s !== undefined && s !== "ok";
}
