import type { AnnotationRow } from "@obelus/repo";
import type { JSX, ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import MarginGutter from "./MarginGutter";
import type { DocumentView } from "./types";
import "./review-shell.css";

const MOBILE_BREAKPOINT = 900;

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
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const gutterRef = useRef<HTMLElement | null>(null);
  const [gutterOffsetTop, setGutterOffsetTop] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    const onChange = (): void => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

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

  const focusMark = (id: string): void => {
    onFocusMark(id);
    if (isMobile) setSheetOpen(true);
    documentView.scrollToAnnotation(id);
  };

  return (
    <>
      {header}
      <section
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
          <div className="review-shell__pane">{pane}</div>
        )}
      </section>
    </>
  );
}
