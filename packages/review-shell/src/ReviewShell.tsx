import type { AnnotationRow } from "@obelus/repo";
import type { JSX, ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import MarginGutter from "./MarginGutter";
import ReviewDivider, { clampPaneWidth, MIN_DOC_WIDTH, MIN_PANE_WIDTH } from "./ReviewDivider";
import type { DocumentView } from "./types";
import "./review-shell.css";

const MOBILE_BREAKPOINT = 900;
const STORAGE_KEY = "obelus.review-shell.pane-width";

function loadStoredWidth(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function saveStoredWidth(value: number | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, String(Math.round(value)));
  } catch {
    // localStorage may be disabled (private mode) or full; ignore.
  }
}

type Props = {
  /** Accessible label for the outer grid, e.g. "Review paperId". */
  label: string;
  /** Optional chrome rendered above the grid (breadcrumb / title bar). */
  header?: ReactNode;
  /** Adapter supplying the document content + annotation positioning. */
  documentView: DocumentView;
  /** Saved annotations; margin notes are drawn for each one the view can locate. */
  annotations: ReadonlyArray<AnnotationRow>;
  /** Right-column content. Web and desktop both mount ReviewPane here. */
  pane: ReactNode;
  /** Whether a draft composer is open; on mobile this auto-opens the sheet. */
  draftOpen: boolean;
  /** Focus a saved mark (clicking a margin note routes through here). */
  onFocusMark: (id: string) => void;
};

export default function ReviewShell({
  label,
  header,
  documentView,
  annotations,
  pane,
  draftOpen,
  onFocusMark,
}: Props): JSX.Element {
  const shellRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const gutterRef = useRef<HTMLElement | null>(null);
  const [gutterOffsetTop, setGutterOffsetTop] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [paneWidthPx, setPaneWidthPx] = useState<number | null>(() => loadStoredWidth());

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    const onChange = (): void => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Mirror paneWidthPx into the CSS custom property the grid reads. Imperative
  // so we don't have to fight exactOptionalPropertyTypes around inline style.
  useLayoutEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    if (paneWidthPx === null) {
      el.style.removeProperty("--review-shell-pane-track");
    } else {
      el.style.setProperty("--review-shell-pane-track", `${paneWidthPx}px`);
    }
  }, [paneWidthPx]);

  // Persist after the user settles on a width. Debounce so we don't thrash
  // localStorage on every pointermove.
  useEffect(() => {
    if (paneWidthPx === null) {
      saveStoredWidth(null);
      return;
    }
    const t = window.setTimeout(() => saveStoredWidth(paneWidthPx), 200);
    return () => window.clearTimeout(t);
  }, [paneWidthPx]);

  // Re-clamp if the viewport shrinks below what the saved pane width can fit.
  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setPaneWidthPx((prev) => {
        if (prev === null) return null;
        const cols = getComputedStyle(el).gridTemplateColumns.split(" ").map(Number.parseFloat);
        const gap = cols[1] ?? 0;
        const max = Math.max(
          MIN_PANE_WIDTH,
          el.getBoundingClientRect().width - MIN_DOC_WIDTH - gap,
        );
        return prev > max ? clampPaneWidth(prev, el.getBoundingClientRect().width, gap) : prev;
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const resetPaneWidth = useCallback(() => setPaneWidthPx(null), []);

  // Auto-open the sheet on mobile when a draft lands, matching the web
  // experience prior to the extraction.
  useEffect(() => {
    if (!isMobile) return;
    if (draftOpen) setSheetOpen(true);
  }, [isMobile, draftOpen]);

  // annotationTops changing is the proxy signal for "the adapter's layout
  // settled enough that the gutter's offsetTop is meaningful" — we recompute
  // once per layout pass. gutterRef is a ref and intentionally not in deps.
  // biome-ignore lint/correctness/useExhaustiveDependencies: gutterRef is a ref; annotationTops is the layout-pass trigger.
  useLayoutEffect(() => {
    setGutterOffsetTop(gutterRef.current?.offsetTop ?? 0);
  }, [documentView.annotationTops]);

  // Clicking a margin note focuses the mark; ReviewPane's effect on
  // focusedAnnotationId handles the scroll. We deliberately don't call
  // documentView.scrollToAnnotation here — the gutter and the document share a
  // single scroll container, so a visible gutter note is already at its source
  // line, and issuing a second smooth scroll just races the pane's
  // scrollIntoView.
  const focusMark = (id: string): void => {
    onFocusMark(id);
    if (isMobile) setSheetOpen(true);
  };

  return (
    <>
      {header}
      <section
        ref={shellRef}
        className="review-shell"
        aria-label={label}
        data-editable={documentView.editable ? "true" : "false"}
      >
        <div className="review-shell__scroll" ref={scrollRef}>
          {documentView.content}
          <MarginGutter
            annotations={annotations}
            annotationTops={documentView.annotationTops}
            gutterRef={gutterRef}
            gutterOffsetTop={gutterOffsetTop}
            onSelectMark={focusMark}
          />
        </div>
        {isMobile ? (
          <>
            <button
              type="button"
              className="review-shell__sheet-toggle"
              onClick={() => setSheetOpen(true)}
            >
              <span>{`Marks · ${annotations.length}`}</span>
              <span aria-hidden="true">{"⌃"}</span>
            </button>
            <aside
              className="review-shell__sheet review-shell__pane"
              data-open={sheetOpen ? "true" : "false"}
              aria-hidden={!sheetOpen}
            >
              <button
                type="button"
                className="review-shell__sheet-close"
                onClick={() => setSheetOpen(false)}
              >
                close
              </button>
              {pane}
            </aside>
          </>
        ) : (
          <>
            <ReviewDivider
              shellRef={shellRef}
              valueNow={paneWidthPx ?? undefined}
              onChange={setPaneWidthPx}
              onReset={resetPaneWidth}
            />
            <div className="review-shell__pane">{pane}</div>
          </>
        )}
      </section>
    </>
  );
}
