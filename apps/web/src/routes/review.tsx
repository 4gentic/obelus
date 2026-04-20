import { type Anchor, extract, rectsFromAnchor } from "@obelus/anchor";
import { loadDocument, PdfDocument, SelectionListener } from "@obelus/pdf-view";
import type { PaperRow, PaperRubric } from "@obelus/repo";
import { getPdf, papers, revisions } from "@obelus/repo/web";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { buildBundle } from "../bundle/build";
import { copyClipboardPrompt, copyReviewClipboardPrompt } from "../bundle/clipboard";
import {
  exportBundleFile,
  exportBundleMarkdown,
  exportReviewBundleMarkdown,
} from "../bundle/download";
import { type DraftInput, type DraftSlice, useReviewStore } from "../store/review-store";
import MarginNote from "./review/MarginNote";
import ReviewPane from "./review/ReviewPane";
import "./review.css";

import type { JSX } from "react";

type Status = "idle" | "working" | "done" | "error";

const BASE_SCALE = 1.25;
const SAFETY_MIN_SCALE = 0.25;
const PDF_POINT_WIDTH = 612;
const GUTTER_RESERVED = 220;
const COLUMN_PADDING = 96;
const MOBILE_BREAKPOINT = 900;

// Shrink-to-fit so the page never overflows into the gutter reserve. Any
// readability floor taller than the container content box forces the page to
// overflow and the absolute-positioned gutter to paint on top of it. Mobile
// mode handles genuinely tiny viewports via the sheet layout below
// MOBILE_BREAKPOINT; the safety min here only guards against degenerate widths.
function pickScale(columnWidth: number, mobile: boolean): number {
  const available = columnWidth - (mobile ? 32 : GUTTER_RESERVED + COLUMN_PADDING);
  if (available <= 0) return SAFETY_MIN_SCALE;
  const fit = available / PDF_POINT_WIDTH;
  return Math.max(SAFETY_MIN_SCALE, Math.min(BASE_SCALE, fit));
}

export default function Review() {
  const { paperId } = useParams();
  const [revisionId, setRevisionId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [paper, setPaper] = useState<PaperRow | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageRects, setPageRects] = useState<{ top: number; left: number }[]>([]);
  const [gutterOffsetTop, setGutterOffsetTop] = useState(0);
  const [scale, setScale] = useState(BASE_SCALE);
  const [isMobile, setIsMobile] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const gutterRef = useRef<HTMLElement | null>(null);
  const annotations = useReviewStore((s) => s.annotations);
  const selectedAnchor = useReviewStore((s) => s.selectedAnchor);
  const draftCategory = useReviewStore((s) => s.draftCategory);
  const draftNote = useReviewStore((s) => s.draftNote);
  const focusedAnnotationId = useReviewStore((s) => s.focusedAnnotationId);
  const load = useReviewStore((s) => s.load);
  const setSelectedAnchor = useReviewStore((s) => s.setSelectedAnchor);
  const setDraftCategory = useReviewStore((s) => s.setDraftCategory);
  const setDraftNote = useReviewStore((s) => s.setDraftNote);
  const setFocusedAnnotation = useReviewStore((s) => s.setFocusedAnnotation);
  const saveAnnotation = useReviewStore((s) => s.saveAnnotation);
  const updateAnnotation = useReviewStore((s) => s.updateAnnotation);
  const deleteAnnotation = useReviewStore((s) => s.deleteAnnotation);
  const deleteGroup = useReviewStore((s) => s.deleteGroup);

  useEffect(() => {
    if (!paperId) return;
    void revisions.listForPaper(paperId).then((list) => {
      const last = list.at(-1);
      if (last) {
        setRevisionId(last.id);
        void load(last.id);
      }
    });
  }, [paperId, load]);

  useEffect(() => {
    let cancelled = false;
    async function run(): Promise<void> {
      if (!paperId) return;
      const row = await papers.get(paperId);
      if (!row) return;
      if (!cancelled) setPaper(row);
      const bytes = await getPdf(row.pdfSha256);
      if (!bytes) return;
      const pdf = await loadDocument(bytes);
      if (!cancelled) {
        setDoc(pdf);
        setPageCount(pdf.numPages);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [paperId]);

  const onRenamePaper = useCallback(
    async (title: string) => {
      if (!paperId) return;
      await papers.rename(paperId, title);
      setPaper((prev) => (prev ? { ...prev, title: title.trim() || "Untitled" } : prev));
    },
    [paperId],
  );

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    const onChange = (): void => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!selectedAnchor) return;
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      setSelectedAnchor(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectedAnchor, setSelectedAnchor]);

  // Pick a render scale that fits the scroll column's width, reserving the
  // margin-gutter on desktop. The PDF page width in points is 612 at scale 1.
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const measure = (): void => {
      const width = scroll.clientWidth;
      const next = pickScale(width, isMobile);
      setScale((prev) => (Math.abs(prev - next) < 0.01 ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scroll);
    return () => ro.disconnect();
  }, [isMobile]);

  // Recompute per-page slot offsets whenever layout changes. slot.offsetTop is
  // measured in `.review__scroll` (the nearest positioned ancestor). The gutter
  // is also absolutely positioned inside `.review__scroll`, so we subtract its
  // offsetTop when placing margin notes so `top = slot.offsetTop + bbox.y`
  // lines up visually with the page row.
  useLayoutEffect(() => {
    if (!doc) return;
    const container = scrollRef.current;
    if (!container) return;

    const measure = (): void => {
      const slots = container.querySelectorAll<HTMLElement>("[data-page-slot]");
      const rects: { top: number; left: number }[] = Array.from({ length: pageCount }, () => ({
        top: 0,
        left: 0,
      }));
      for (const slot of slots) {
        const idxRaw = slot.dataset.pageSlot;
        if (!idxRaw) continue;
        const idx = Number.parseInt(idxRaw, 10);
        if (!Number.isFinite(idx)) continue;
        rects[idx] = { top: slot.offsetTop, left: slot.offsetLeft };
      }
      setPageRects(rects);
      setGutterOffsetTop(gutterRef.current?.offsetTop ?? 0);
    };

    measure();
    // `.review__scroll` is a fixed-height scroll viewport, so its own box
    // doesn't change when PDF pages finish rendering and stretch their slots.
    // Observe the slots (and the flex column) instead — that's the signal we
    // need to re-measure after each `PdfPage` async-renders.
    const ro = new ResizeObserver(measure);
    const slots = container.querySelectorAll<HTMLElement>("[data-page-slot]");
    for (const slot of slots) ro.observe(slot);
    const pdfDoc = container.querySelector<HTMLElement>(".pdf-doc");
    if (pdfDoc) ro.observe(pdfDoc);
    return () => ro.disconnect();
  }, [doc, pageCount]);

  const onAnchor = useCallback(
    (
      anchors: Anchor[],
      _quote: string,
      itemsByPage: ReadonlyMap<number, ReadonlyArray<TextItem>>,
    ) => {
      if (!doc || anchors.length === 0) return;
      void (async () => {
        const built = await Promise.all(
          anchors.map(async (anchor) => {
            // Use the items the anchor was derived from — re-fetching via
            // getTextContent here can produce a stream that re-aligns indices
            // and silently puts the rects on different items than the quote.
            const items = itemsByPage.get(anchor.pageIndex);
            if (!items) return null;
            const page = await doc.getPage(anchor.pageIndex + 1);
            // Store rects/bbox in scale-independent space; the overlay scales them at
            // render time so highlights stay aligned when the page re-renders at a
            // different scale (e.g. window resize).
            const viewport = page.getViewport({ scale: 1 });
            const ext = extract(anchor, items, viewport);
            const rects = rectsFromAnchor(anchor, items, viewport);
            return {
              anchor,
              quote: ext.quote,
              contextBefore: ext.contextBefore,
              contextAfter: ext.contextAfter,
              bbox: ext.bbox,
              rects,
            };
          }),
        );
        const slices: DraftSlice[] = built.filter((s): s is DraftSlice => s !== null);
        const first = slices[0];
        const last = slices[slices.length - 1];
        if (!first || !last) return;
        const draft: DraftInput = {
          slices,
          quote: slices.map((s) => s.quote).join(" \u2026 "),
          contextBefore: first.contextBefore,
          contextAfter: last.contextAfter,
        };
        setSelectedAnchor(draft);
      })();
    },
    [doc, setSelectedAnchor],
  );

  const onExport = useCallback(async () => {
    if (!paperId || !revisionId) return;
    setStatus("working");
    setMessage(null);
    try {
      const bundle = await buildBundle({
        paperId,
        revisionId,
        pdfFilename: "paper.pdf",
        pageCount: pageCount || 1,
      });
      await exportBundleFile(bundle);
      setStatus("done");
      setMessage("Bundle exported.");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Export failed");
    }
  }, [paperId, revisionId, pageCount]);

  const onExportMarkdown = useCallback(async () => {
    if (!paperId || !revisionId) return;
    setStatus("working");
    setMessage(null);
    try {
      const bundle = await buildBundle({
        paperId,
        revisionId,
        pdfFilename: "paper.pdf",
        pageCount: pageCount || 1,
      });
      await exportBundleMarkdown(bundle);
      setStatus("done");
      setMessage("Markdown exported.");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Export failed");
    }
  }, [paperId, revisionId, pageCount]);

  const onCopy = useCallback(async () => {
    if (!paperId || !revisionId) return;
    setStatus("working");
    setMessage(null);
    try {
      const bundle = await buildBundle({
        paperId,
        revisionId,
        pdfFilename: "paper.pdf",
        pageCount: pageCount || 1,
      });
      await copyClipboardPrompt(bundle);
      setStatus("done");
      setMessage("Prompt copied to clipboard.");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Copy failed");
    }
  }, [paperId, revisionId, pageCount]);

  const onCopyReview = useCallback(async () => {
    if (!paperId || !revisionId) return;
    setStatus("working");
    setMessage(null);
    try {
      const bundle = await buildBundle({
        paperId,
        revisionId,
        pdfFilename: "paper.pdf",
        pageCount: pageCount || 1,
      });
      const rubric = paper?.rubric
        ? { label: paper.rubric.label, body: paper.rubric.body }
        : undefined;
      await copyReviewClipboardPrompt(bundle, rubric);
      setStatus("done");
      setMessage(rubric ? "Review prompt copied with rubric." : "Review prompt copied.");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Copy failed");
    }
  }, [paperId, revisionId, pageCount, paper]);

  const onExportReviewMarkdown = useCallback(async () => {
    if (!paperId || !revisionId) return;
    setStatus("working");
    setMessage(null);
    try {
      const bundle = await buildBundle({
        paperId,
        revisionId,
        pdfFilename: "paper.pdf",
        pageCount: pageCount || 1,
      });
      const rubric = paper?.rubric
        ? { label: paper.rubric.label, body: paper.rubric.body }
        : undefined;
      await exportReviewBundleMarkdown(bundle, rubric);
      setStatus("done");
      setMessage("Review Markdown exported.");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Export failed");
    }
  }, [paperId, revisionId, pageCount, paper]);

  const onRubricChange = useCallback(
    async (next: PaperRubric | null): Promise<void> => {
      if (!paperId) return;
      await papers.setRubric(paperId, next);
      setPaper((prev) => {
        if (!prev) return prev;
        if (next === null) {
          const { rubric: _drop, ...rest } = prev;
          return rest;
        }
        return { ...prev, rubric: next };
      });
    },
    [paperId],
  );

  const disabled = !paperId || !revisionId || status === "working";

  // Desired top = the source line's Y. Sorted so collision resolution walks
  // top-to-bottom in document order.
  const desiredNotes = useMemo(() => {
    return annotations
      .map((row) => {
        const rect = pageRects[row.page - 1] ?? { top: 0, left: 0 };
        const desiredTop = rect.top - gutterOffsetTop + row.bbox[1] * scale;
        return { row, desiredTop };
      })
      .sort((a, b) => a.desiredTop - b.desiredTop);
  }, [annotations, pageRects, gutterOffsetTop, scale]);

  const noteRefs = useRef<Map<string, HTMLElement>>(new Map());
  const registerNoteRef = useCallback((id: string, el: HTMLElement | null): void => {
    if (el) noteRefs.current.set(id, el);
    else noteRefs.current.delete(id);
  }, []);

  const [resolvedTops, setResolvedTops] = useState<Record<string, number>>({});

  // Collision-resolve margin-note positions. Each note wants to sit at its
  // source line's Y, but notes are taller than a text line, so close-together
  // highlights would overlap. Walk top-to-bottom and push each note down to
  // clear the previous one's bottom edge + gap. Read measured heights from
  // the refs so long bodies don't get covered by the next card.
  useLayoutEffect(() => {
    const NOTE_GAP = 8;
    const next: Record<string, number> = {};
    let lastBottom = Number.NEGATIVE_INFINITY;
    for (const { row, desiredTop } of desiredNotes) {
      const el = noteRefs.current.get(row.id);
      const height = el?.offsetHeight ?? 64;
      const top = Math.max(desiredTop, lastBottom + NOTE_GAP);
      next[row.id] = top;
      lastBottom = top + height;
    }
    setResolvedTops((prev) => {
      const keys = Object.keys(next);
      if (Object.keys(prev).length !== keys.length) return next;
      for (const id of keys) if (prev[id] !== next[id]) return next;
      return prev;
    });
  }, [desiredNotes]);

  const marginNotes = useMemo(
    () =>
      desiredNotes.map(({ row, desiredTop }) => ({
        row,
        top: resolvedTops[row.id] ?? desiredTop,
      })),
    [desiredNotes, resolvedTops],
  );

  const focusMark = useCallback(
    (id: string) => {
      setFocusedAnnotation(id);
      if (isMobile) setSheetOpen(true);
    },
    [isMobile, setFocusedAnnotation],
  );

  // Auto-open the sheet on mobile when a draft is in progress.
  useEffect(() => {
    if (!isMobile) return;
    if (selectedAnchor) setSheetOpen(true);
  }, [isMobile, selectedAnchor]);

  const paneEl = (
    <ReviewPane
      annotations={annotations}
      selectedAnchor={selectedAnchor}
      draftCategory={draftCategory}
      draftNote={draftNote}
      focusedAnnotationId={focusedAnnotationId}
      rubric={paper?.rubric ?? null}
      onSave={saveAnnotation}
      onDiscard={() => setSelectedAnchor(null)}
      onDraftCategoryChange={setDraftCategory}
      onDraftNoteChange={setDraftNote}
      onUpdateNote={(id, note) => updateAnnotation(id, { note })}
      onDelete={deleteAnnotation}
      onDeleteGroup={deleteGroup}
      onExport={() => void onExport()}
      onExportMarkdown={() => void onExportMarkdown()}
      onExportReviewMarkdown={() => void onExportReviewMarkdown()}
      onCopy={() => void onCopy()}
      onCopyReview={() => void onCopyReview()}
      onRubricChange={onRubricChange}
      exportDisabled={disabled}
      statusMessage={message}
      statusTone={status}
    />
  );

  return (
    <>
      <ReviewBreadcrumb paper={paper} onRename={(t) => void onRenamePaper(t)} />
      <section className="review" aria-label={`Review ${paperId ?? ""}`}>
        <div className="review__scroll" ref={scrollRef}>
          {doc ? (
            <SelectionListener doc={doc} onAnchor={onAnchor}>
              <PdfDocument doc={doc} scale={scale} />
              <div className="review__hl-layer" aria-hidden="true">
                {annotations.flatMap((row) => {
                  const page = pageRects[row.page - 1] ?? { top: 0, left: 0 };
                  const lineRects = row.rects && row.rects.length > 0 ? row.rects : [row.bbox];
                  return lineRects.map((r) => {
                    const [x, y, w, h] = r;
                    return (
                      <div
                        key={`${row.id}-${x}-${y}-${w}-${h}`}
                        className="review__hl"
                        data-category={row.category}
                        style={{
                          left: page.left + x * scale,
                          top: page.top + y * scale,
                          width: w * scale,
                          height: h * scale,
                        }}
                      />
                    );
                  });
                })}
                {selectedAnchor
                  ? selectedAnchor.slices.flatMap((slice) => {
                      const page = pageRects[slice.anchor.pageIndex] ?? {
                        top: 0,
                        left: 0,
                      };
                      return slice.rects.map((r) => {
                        const [x, y, w, h] = r;
                        return (
                          <div
                            key={`draft-${slice.anchor.pageIndex}-${x}-${y}-${w}-${h}`}
                            className="review__hl review__hl--draft"
                            data-category={draftCategory ?? undefined}
                            style={{
                              left: page.left + x * scale,
                              top: page.top + y * scale,
                              width: w * scale,
                              height: h * scale,
                            }}
                          />
                        );
                      });
                    })
                  : null}
              </div>
            </SelectionListener>
          ) : (
            <span className="review__label">loading</span>
          )}
          <aside className="review__gutter" ref={gutterRef} aria-label="Margin notes">
            {marginNotes.map(({ row, top }) => (
              <MarginNote
                key={row.id}
                annotation={row}
                top={top}
                onSelect={focusMark}
                onRef={registerNoteRef}
              />
            ))}
          </aside>
        </div>
        {isMobile ? (
          <>
            <button
              type="button"
              className="review__sheet-toggle"
              onClick={() => setSheetOpen(true)}
            >
              <span>{`Marks \u00b7 ${annotations.length}`}</span>
              <span aria-hidden="true">{"\u2303"}</span>
            </button>
            <aside
              className="review__sheet review__pane"
              data-open={sheetOpen ? "true" : "false"}
              aria-hidden={!sheetOpen}
            >
              <button
                type="button"
                className="review__sheet-close"
                onClick={() => setSheetOpen(false)}
              >
                close
              </button>
              {paneEl}
            </aside>
          </>
        ) : (
          <div className="review__pane">{paneEl}</div>
        )}
      </section>
    </>
  );
}

type ReviewBreadcrumbProps = {
  paper: PaperRow | null;
  onRename: (title: string) => void;
};

function ReviewBreadcrumb({ paper, onRename }: ReviewBreadcrumbProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function commit(): void {
    if (!paper) return;
    const next = value.trim() || "Untitled";
    if (next !== paper.title) onRename(next);
    setEditing(false);
  }

  function cancel(): void {
    setEditing(false);
  }

  return (
    <nav className="review-crumb" aria-label="Paper">
      <Link to="/app" className="review-crumb__back">
        <span aria-hidden="true">←</span> Library
      </Link>
      {paper ? (
        editing ? (
          <input
            ref={inputRef}
            className="review-crumb__input"
            type="text"
            value={value}
            aria-label="Paper title"
            onChange={(e) => setValue(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="review-crumb__title"
            onClick={() => {
              setValue(paper.title);
              setEditing(true);
            }}
            aria-label={`Rename ${paper.title}`}
          >
            {paper.title}
          </button>
        )
      ) : null}
    </nav>
  );
}
