import { type Anchor, extract, rectsFromAnchor } from "@obelus/anchor";
import { type AnnotationRow, isPdfAnchored } from "@obelus/repo";
import type { DocumentView } from "@obelus/review-shell";
import type { DraftInput, PdfDraftSlice } from "@obelus/review-store";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { type ReactNode, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import PdfDocument from "./PdfDocument";
import SelectionListener from "./SelectionListener";

const BASE_SCALE = 1.25;
const SAFETY_MIN_SCALE = 0.25;
const PDF_POINT_WIDTH = 612;

// The adapter's inner clientWidth already excludes the scroll container's
// right-padding (which reserves the 220px gutter on desktop). At the mobile
// breakpoint the padding shrinks, so the adapter picks up the larger width
// automatically without any knowledge of the layout mode.
function pickScale(columnWidth: number): number {
  if (columnWidth <= 0) return SAFETY_MIN_SCALE;
  const fit = columnWidth / PDF_POINT_WIDTH;
  return Math.max(SAFETY_MIN_SCALE, Math.min(BASE_SCALE, fit));
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
}: Params): DocumentView {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(BASE_SCALE);
  const [pageRects, setPageRects] = useState<PageRect[]>([]);
  const pageCount = doc.numPages;

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = (): void => {
      const w = el.clientWidth;
      const next = pickScale(w);
      setScale((prev) => (Math.abs(prev - next) < 0.01 ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
      const scroll = containerRef.current?.closest<HTMLElement>(".review-shell__scroll");
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
              style={{ left: x * s, top: y * s, width: w * s, height: h * s }}
            />
          );
        });
      });
      const draftRects = selectedAnchor
        ? selectedAnchor.slices.flatMap((slice) => {
            if (slice.kind === "source") return [];
            if (slice.anchor.pageIndex !== pageIndex) return [];
            return slice.rects.map((r) => {
              const [x, y, w, h] = r;
              return (
                <div
                  key={`draft-${pageIndex}-${x}-${y}`}
                  className={draftCls}
                  data-category={draftCategory ?? undefined}
                  style={{ left: x * s, top: y * s, width: w * s, height: h * s }}
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
    <div ref={containerRef} className="pdf-adapter" onClick={onHitTest}>
      <SelectionListener onAnchor={handleAnchor}>
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
