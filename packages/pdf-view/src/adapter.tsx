import { type Anchor, extract, rectsFromAnchor } from "@obelus/anchor";
import { type AnnotationRow, isPdfAnchored } from "@obelus/repo";
import type { DocumentView } from "@obelus/review-shell";
import type { DraftInput, PdfDraftSlice } from "@obelus/review-store";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { type ReactNode, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import PdfDocument from "./PdfDocument";
import SelectionListener from "./SelectionListener";

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

const BASE_SCALE = 1.25;
const SAFETY_MIN_SCALE = 0.25;
const FIT_MAX_SCALE = 2;
const PDF_POINT_WIDTH = 612;

// Render-time padding around stored rects so highlights cover the visual
// line-box (cap-line + leading + descender) the way Acrobat does, not just the
// glyph bounding box pdfjs reports. mergeByLine already extends each rect to
// the page's median baseline-to-baseline distance, so these pads only need to
// extend a touch further to make adjacent rects abut without seam. Overlap on
// translucent fills produces a darker double-stripe; aim for tile, not stack.
const HL_PAD_TOP = 0.04;
const HL_PAD_BOTTOM = 0.22;

function hlStyle(x: number, y: number, w: number, h: number, s: number) {
  const padT = h * HL_PAD_TOP;
  const padB = h * HL_PAD_BOTTOM;
  return {
    left: x * s,
    top: (y - padT) * s,
    width: w * s,
    height: (h + padT + padB) * s,
  };
}

// The adapter's inner clientWidth already excludes the scroll container's
// right-padding (which reserves the 220px gutter on desktop). At the mobile
// breakpoint the padding shrinks, so the adapter picks up the larger width
// automatically without any knowledge of the layout mode.
// Auto-fit grows the PDF to fill the column up to FIT_MAX_SCALE. Previously
// capped at BASE_SCALE (125%), which left visible empty gutters on wider
// screens. Manual zoom still exceeds this through `zoomOverride`, clamped
// independently in pdf-zoom-store.
function pickScale(columnWidth: number): number {
  if (columnWidth <= 0) return SAFETY_MIN_SCALE;
  const fit = columnWidth / PDF_POINT_WIDTH;
  return Math.max(SAFETY_MIN_SCALE, Math.min(FIT_MAX_SCALE, fit));
}

type Params = {
  doc: PDFDocumentProxy;
  annotations: ReadonlyArray<AnnotationRow>;
  selectedAnchor: DraftInput | null;
  draftCategory: string | null;
  focusedId: string | null;
  onAnchor: (draft: DraftInput) => void;
  onFocusMark: (id: string | null) => void;
  /**
   * Base class for the annotation highlight rects. Web consumers stay on the
   * default to pick up `@obelus/review-shell/review-shell.css`; desktop can
   * pass `"pdf-hl"` to keep its existing per-app styling intact.
   */
  highlightClassName?: string;
  /** Extra overlay injected into each page (e.g. find-match highlights). */
  renderExtraOverlay?: (pageIndex: number, scale: number) => ReactNode;
  /**
   * Manual zoom override. When non-null, replaces the auto-fit scale and the
   * ResizeObserver no longer drives `scale`. Null (the default) keeps the
   * existing fit-to-width behaviour. Caller is responsible for clamping.
   */
  zoomOverride?: number | null;
  /**
   * Notified whenever the measured auto-fit scale changes. Lets a host store
   * step zoom relative to the live fit-to-width value instead of a fixed
   * baseline — without this, "+" from Auto can visibly shrink on wide
   * columns where autoScale > the baseline. Optional so `apps/web` consumers
   * can ignore it.
   */
  onAutoScaleChange?: (scale: number) => void;
  /**
   * When true, switch the document into pan mode: cursor becomes grab/grabbing,
   * mousedown-drag scrolls the surrounding `.review-shell__scroll` container
   * instead of starting a text selection, and the text layer is set
   * non-selectable so accidental blue-painting never appears mid-pan.
   */
  panMode?: boolean;
};

type PageRect = { top: number; left: number };

export function usePdfDocumentView({
  doc,
  annotations,
  selectedAnchor,
  draftCategory,
  focusedId,
  onAnchor,
  onFocusMark,
  highlightClassName = "review-shell__hl",
  renderExtraOverlay,
  zoomOverride = null,
  onAutoScaleChange,
  panMode = false,
}: Params): DocumentView {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [autoScale, setAutoScale] = useState(BASE_SCALE);
  const [pageRects, setPageRects] = useState<PageRect[]>([]);
  const pageCount = doc.numPages;
  const scale = zoomOverride ?? autoScale;

  // Auto-fit measurement runs regardless of `zoomOverride` so the host store
  // always has a current fit-to-width baseline to step from. The render path
  // (`scale = zoomOverride ?? autoScale`) decides which one to draw with.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = (): void => {
      const w = el.clientWidth;
      const next = pickScale(w);
      setAutoScale((prev) => (Math.abs(prev - next) < 0.01 ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    onAutoScaleChange?.(autoScale);
  }, [autoScale, onAutoScaleChange]);

  // Per-page slot offsets relative to the nearest positioned ancestor (which
  // is `.review-shell__scroll`, not this adapter's own root — we leave the
  // root unpositioned so offsetTop bubbles past it).
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = (): void => {
      const slots = container.querySelectorAll<HTMLElement>("[data-page-slot]");
      const rects: PageRect[] = Array.from({ length: pageCount }, () => ({ top: 0, left: 0 }));
      for (const slot of slots) {
        const idxRaw = slot.dataset.pageSlot;
        if (!idxRaw) continue;
        const idx = Number.parseInt(idxRaw, 10);
        if (!Number.isFinite(idx)) continue;
        rects[idx] = { top: slot.offsetTop, left: slot.offsetLeft };
      }
      setPageRects(rects);
    };

    measure();
    const ro = new ResizeObserver(measure);
    const slots = container.querySelectorAll<HTMLElement>("[data-page-slot]");
    for (const slot of slots) ro.observe(slot);
    const pdfDoc = container.querySelector<HTMLElement>(".pdf-doc");
    if (pdfDoc) ro.observe(pdfDoc);
    return () => ro.disconnect();
  }, [pageCount]);

  const annotationTops = useMemo<Map<string, number>>(() => {
    const out = new Map<string, number>();
    for (const row of annotations) {
      if (!isPdfAnchored(row)) continue;
      const page = pageRects[row.anchor.page - 1];
      if (!page) continue;
      out.set(row.id, page.top + row.anchor.bbox[1] * scale);
    }
    return out;
  }, [annotations, pageRects, scale]);

  const scrollToAnnotation = useCallback(
    (id: string): void => {
      const el = containerRef.current;
      const scroll = el ? findScrollAncestor(el) : null;
      const top = annotationTops.get(id);
      if (scroll && top !== undefined) {
        scroll.scrollTo({ top: Math.max(0, top - 100), behavior: "smooth" });
      }
    },
    [annotationTops],
  );

  const handleAnchor = useCallback(
    (
      anchors: Anchor[],
      _quote: string,
      itemsByPage: ReadonlyMap<number, ReadonlyArray<TextItem>>,
    ): void => {
      if (anchors.length === 0) return;
      void (async () => {
        const built = await Promise.all(
          anchors.map(async (anchor): Promise<PdfDraftSlice | null> => {
            const items = itemsByPage.get(anchor.pageIndex);
            if (!items) return null;
            const page = await doc.getPage(anchor.pageIndex + 1);
            const viewport = page.getViewport({ scale: 1 });
            const ext = extract(anchor, items, viewport);
            const rects = rectsFromAnchor(anchor, items, viewport);
            return {
              kind: "pdf",
              anchor,
              quote: ext.quote,
              contextBefore: ext.contextBefore,
              contextAfter: ext.contextAfter,
              bbox: ext.bbox,
              rects,
            };
          }),
        );
        const slices = built.filter((s): s is PdfDraftSlice => s !== null);
        const first = slices[0];
        const last = slices[slices.length - 1];
        if (!first || !last) return;
        onAnchor({
          slices,
          quote: slices.map((s) => s.quote).join(" … "),
          contextBefore: first.contextBefore,
          contextAfter: last.contextAfter,
        });
      })();
    },
    [doc, onAnchor],
  );

  // Per-page overlay: saved marks + draft rects + whatever the consumer
  // layered on (find matches today). Rects are PDF-page-relative so they
  // scale-convert cleanly without knowing scroll-container coords.
  const renderPageOverlay = useCallback(
    (pageIndex: number, s: number): ReactNode => {
      const cls = highlightClassName;
      const draftCls = `${cls} ${cls}--draft`;
      const savedRects = annotations.flatMap((row) => {
        if (!isPdfAnchored(row)) return [];
        if (row.anchor.page - 1 !== pageIndex) return [];
        const lineRects =
          row.anchor.rects && row.anchor.rects.length > 0 ? row.anchor.rects : [row.anchor.bbox];
        return lineRects.map((r) => {
          const [x, y, w, h] = r;
          return (
            <div
              key={`ann-${row.id}-${x}-${y}`}
              className={cls}
              data-category={row.category}
              data-focused={focusedId === row.id ? "true" : undefined}
              style={hlStyle(x, y, w, h, s)}
            />
          );
        });
      });
      const draftRects = selectedAnchor
        ? selectedAnchor.slices.flatMap((slice) => {
            if (slice.kind === "source" || slice.kind === "html" || slice.kind === "html-element") {
              return [];
            }
            if (slice.anchor.pageIndex !== pageIndex) return [];
            return slice.rects.map((r) => {
              const [x, y, w, h] = r;
              return (
                <div
                  key={`draft-${pageIndex}-${x}-${y}`}
                  className={draftCls}
                  data-category={draftCategory ?? undefined}
                  style={hlStyle(x, y, w, h, s)}
                />
              );
            });
          })
        : [];
      const extra = renderExtraOverlay?.(pageIndex, s) ?? null;
      return (
        <>
          {savedRects}
          {draftRects}
          {extra}
        </>
      );
    },
    [annotations, selectedAnchor, draftCategory, focusedId, highlightClassName, renderExtraOverlay],
  );

  // Hit-test click to focus a saved mark. pdfjs's text layer sits above the
  // overlay and swallows per-rect clicks, so we delegate from the adapter
  // root and map clientX/Y → page → annotation rect.
  const onHitTest = useCallback(
    (ev: React.MouseEvent<HTMLDivElement>): void => {
      if (!window.getSelection()?.isCollapsed) return;
      const target = ev.target as HTMLElement | null;
      const pageEl = target?.closest<HTMLElement>("[data-page-index]") ?? null;
      if (!pageEl) return;
      const raw = pageEl.getAttribute("data-page-index");
      if (!raw) return;
      const pageIndex = Number.parseInt(raw, 10);
      if (Number.isNaN(pageIndex)) return;
      const pageRect = pageEl.getBoundingClientRect();
      const px = (ev.clientX - pageRect.left) / scale;
      const py = (ev.clientY - pageRect.top) / scale;
      for (let i = annotations.length - 1; i >= 0; i -= 1) {
        const row = annotations[i];
        if (!row || !isPdfAnchored(row)) continue;
        if (row.anchor.page - 1 !== pageIndex) continue;
        const rects =
          row.anchor.rects && row.anchor.rects.length > 0 ? row.anchor.rects : [row.anchor.bbox];
        for (const r of rects) {
          if (px >= r[0] && px <= r[0] + r[2] && py >= r[1] && py <= r[1] + r[3]) {
            onFocusMark(row.id);
            return;
          }
        }
      }
    },
    [annotations, scale, onFocusMark],
  );

  const content = (
    // biome-ignore lint/a11y/useKeyWithClickEvents: event delegation for annotation hit-testing; keyboard path is the margin notes list.
    // biome-ignore lint/a11y/noStaticElementInteractions: event delegation for hit-test; static div wraps a PDF canvas, not a semantic control.
    <div
      ref={containerRef}
      className="pdf-adapter"
      data-pan-mode={panMode ? "true" : undefined}
      onClick={onHitTest}
    >
      <SelectionListener onAnchor={handleAnchor} panMode={panMode}>
        <PdfDocument doc={doc} scale={scale} renderPageOverlay={renderPageOverlay} />
      </SelectionListener>
    </div>
  );

  return {
    content,
    annotationTops,
    scrollToAnnotation,
    editable: false,
  };
}
