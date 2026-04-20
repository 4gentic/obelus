import type { Anchor } from "@obelus/anchor";
import { PdfDocument, SelectionListener } from "@obelus/pdf-view";
import type { AnnotationRow } from "@obelus/repo";
import type { DraftInput } from "@obelus/review-store";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import type { JSX } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useReviewStore } from "./store-context";

interface Props {
  doc: PDFDocumentProxy;
  onAnchor: (
    anchors: Anchor[],
    quote: string,
    itemsByPage: ReadonlyMap<number, ReadonlyArray<TextItem>>,
  ) => void;
}

type Rect = readonly [number, number, number, number];

function rectKey(prefix: string, r: Rect): string {
  return `${prefix}-${r[0]}-${r[1]}-${r[2]}-${r[3]}`;
}

function annotationRectsOnPage(ann: AnnotationRow, pageIndex: number): readonly Rect[] {
  if (ann.page - 1 !== pageIndex) return [];
  if (ann.rects && ann.rects.length > 0) return ann.rects;
  return [ann.bbox];
}

function draftRectsOnPage(draft: DraftInput, pageIndex: number): readonly Rect[] {
  const out: Rect[] = [];
  for (const slice of draft.slices) {
    if (slice.anchor.pageIndex !== pageIndex) continue;
    for (const r of slice.rects) out.push(r);
  }
  return out;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 2.0;
const FALLBACK_SCALE = 1.1;

export default function PdfPane({ doc, onAnchor }: Props): JSX.Element {
  const paneRef = useRef<HTMLDivElement | null>(null);
  const [nativeWidth, setNativeWidth] = useState<number | null>(null);
  const [scale, setScale] = useState<number | null>(null);
  const store = useReviewStore();
  const annotations = store((s) => s.annotations);
  const draft = store((s) => s.selectedAnchor);
  const draftCategory = store((s) => s.draftCategory);
  const focusedId = store((s) => s.focusedAnnotationId);
  const setFocused = store((s) => s.setFocusedAnnotation);

  useEffect(() => {
    let cancelled = false;
    void doc.getPage(1).then((page) => {
      if (cancelled) {
        page.cleanup();
        return;
      }
      const viewport = page.getViewport({ scale: 1 });
      setNativeWidth(viewport.width);
      page.cleanup();
    });
    return () => {
      cancelled = true;
    };
  }, [doc]);

  useLayoutEffect(() => {
    const el = paneRef.current;
    if (!el || !nativeWidth) return;
    const compute = (): void => {
      const style = getComputedStyle(el);
      const padX = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
      const avail = el.clientWidth - padX;
      if (avail <= 0) return;
      const raw = avail / nativeWidth;
      const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, raw));
      setScale(Math.round(clamped * 100) / 100);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [nativeWidth]);

  const effectiveScale = scale ?? FALLBACK_SCALE;

  const renderPageOverlay = useCallback(
    (pageIndex: number, s: number): JSX.Element => (
      <>
        {annotations.flatMap((row) =>
          annotationRectsOnPage(row, pageIndex).map((r) => {
            const isFocused = focusedId === row.id;
            return (
              <div
                key={rectKey(`ann-${row.id}`, r)}
                className="pdf-hl"
                data-category={row.category}
                data-focused={isFocused ? "true" : undefined}
                style={{
                  left: r[0] * s,
                  top: r[1] * s,
                  width: r[2] * s,
                  height: r[3] * s,
                }}
              />
            );
          }),
        )}
        {draft
          ? draftRectsOnPage(draft, pageIndex).map((r) => (
              <div
                key={rectKey("draft", r)}
                className="pdf-hl pdf-hl--draft"
                data-category={draftCategory ?? undefined}
                style={{
                  left: r[0] * s,
                  top: r[1] * s,
                  width: r[2] * s,
                  height: r[3] * s,
                }}
              />
            ))
          : null}
      </>
    ),
    [annotations, draft, draftCategory, focusedId],
  );

  // Hit-test focus for highlights. Per-rect onClick doesn't fire because
  // pdfjs's text layer sits above the overlay (z-index 2 vs 1) and intercepts
  // every click. We bind one click handler to the pane, let it bubble from
  // the text layer, then map clientX/Y → page → annotation rect.
  const onPaneClick = useCallback(
    (ev: React.MouseEvent<HTMLDivElement>): void => {
      if (!window.getSelection()?.isCollapsed) return;
      const x = ev.clientX;
      const y = ev.clientY;
      const target = ev.target as HTMLElement | null;
      const pageEl = target?.closest<HTMLElement>("[data-page-index]") ?? null;
      if (!pageEl) return;
      const raw = pageEl.getAttribute("data-page-index");
      if (!raw) return;
      const pageIndex = Number.parseInt(raw, 10);
      if (Number.isNaN(pageIndex)) return;
      const pageRect = pageEl.getBoundingClientRect();
      const s = effectiveScale;
      const px = (x - pageRect.left) / s;
      const py = (y - pageRect.top) / s;
      // Iterate top-most first: most recent annotations win on overlap.
      for (let i = annotations.length - 1; i >= 0; i -= 1) {
        const row = annotations[i];
        if (!row) continue;
        const rects = annotationRectsOnPage(row, pageIndex);
        for (const r of rects) {
          if (px >= r[0] && px <= r[0] + r[2] && py >= r[1] && py <= r[1] + r[3]) {
            setFocused(row.id);
            return;
          }
        }
      }
    },
    [annotations, effectiveScale, setFocused],
  );

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: event delegation for annotation hit-testing; keyboard access is via the margin notes list.
    // biome-ignore lint/a11y/noStaticElementInteractions: event delegation for annotation hit-testing; static div wraps a PDF canvas, not a semantic control.
    <div ref={paneRef} className="pdf-pane" onClick={onPaneClick}>
      <SelectionListener doc={doc} onAnchor={onAnchor}>
        <PdfDocument doc={doc} scale={effectiveScale} renderPageOverlay={renderPageOverlay} />
      </SelectionListener>
    </div>
  );
}
