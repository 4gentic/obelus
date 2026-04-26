import { type FindMatch, usePdfDocumentView } from "@obelus/pdf-view";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { JSX, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useFindStore, usePdfFindRectsStore } from "./find-store-context";
import { useReviewStore } from "./store-context";

interface Props {
  doc: PDFDocumentProxy;
}

type Rect = readonly [number, number, number, number];

function rectKey(prefix: string, r: Rect): string {
  return `${prefix}-${r[0]}-${r[1]}-${r[2]}-${r[3]}`;
}

export default function PdfPane({ doc }: Props): JSX.Element {
  const paneRef = useRef<HTMLDivElement | null>(null);
  const store = useReviewStore();
  const annotations = store((s) => s.annotations);
  const selectedAnchor = store((s) => s.selectedAnchor);
  const draftCategory = store((s) => s.draftCategory);
  const focusedId = store((s) => s.focusedAnnotationId);
  const setFocused = store((s) => s.setFocusedAnnotation);
  const setSelectedAnchor = store((s) => s.setSelectedAnchor);
  const findStore = useFindStore();
  const pdfRects = usePdfFindRectsStore();
  const findMatches = pdfRects((s) => s.matches);
  const findCurrentIndex = pdfRects((s) => s.currentIndex);
  const findScrollTick = findStore((s) => s.scrollTick);

  const findMatchesByPage = useMemo(() => {
    const byPage = new Map<number, FindMatch[]>();
    for (const m of findMatches) {
      const bucket = byPage.get(m.pageIndex);
      if (bucket) bucket.push(m);
      else byPage.set(m.pageIndex, [m]);
    }
    return byPage;
  }, [findMatches]);

  const renderExtraOverlay = useCallback(
    (pageIndex: number, s: number): ReactNode => {
      const matches = findMatchesByPage.get(pageIndex) ?? [];
      return matches.flatMap((m) =>
        m.rects.map((r) => {
          const isCurrent = m.matchIndex === findCurrentIndex;
          const cls = isCurrent
            ? "pdf-hl pdf-hl--find pdf-hl--find-current"
            : "pdf-hl pdf-hl--find";
          return (
            <div
              key={rectKey(`find-${m.matchIndex}`, r)}
              className={cls}
              style={{
                left: r[0] * s,
                top: r[1] * s,
                width: r[2] * s,
                height: r[3] * s,
              }}
            />
          );
        }),
      );
    },
    [findMatchesByPage, findCurrentIndex],
  );

  const documentView = usePdfDocumentView({
    doc,
    annotations,
    selectedAnchor,
    draftCategory,
    focusedId,
    onAnchor: (draft) => setSelectedAnchor(draft),
    onFocusMark: (id) => setFocused(id),
    highlightClassName: "pdf-hl",
    renderExtraOverlay,
  });

  // Scroll to the current match's page. `findScrollTick` is listed so a
  // single-match document still re-scrolls when the user presses Next and
  // `findCurrentIndex` stays at 0.
  // biome-ignore lint/correctness/useExhaustiveDependencies: findScrollTick drives re-fire on navigation; the body intentionally doesn't read it.
  useEffect(() => {
    if (findCurrentIndex < 0) return;
    const match = findMatches[findCurrentIndex];
    if (!match) return;
    const pane = paneRef.current;
    if (!pane) return;
    const pageEl = pane.querySelector<HTMLElement>(`[data-page-index="${match.pageIndex}"]`);
    if (!pageEl) return;
    pageEl.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [findScrollTick, findCurrentIndex, findMatches]);

  return (
    <div ref={paneRef} className="pdf-pane">
      {documentView.content}
    </div>
  );
}
