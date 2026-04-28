import { descriptionFor } from "@obelus/categories";
import type { AnnotationRow } from "@obelus/repo";
import {
  type JSX,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useDocumentScroll } from "./document-scroll-context";
import { useReviewStore } from "./store-context";

const NOTE_GAP = 8;
const FALLBACK_NOTE_HEIGHT = 64;

// Row-agnostic "where in the paper" label. Switches on the anchor's
// discriminant. Mirrors `packages/review-shell/src/ReviewPane.tsx::locationLabel`.
function locationLabel(row: AnnotationRow): string {
  if (row.anchor.kind === "pdf") return `p. ${row.anchor.page}`;
  if (row.anchor.kind === "html") {
    if (row.anchor.sourceHint) {
      const { lineStart, lineEnd } = row.anchor.sourceHint;
      return lineStart === lineEnd ? `L${lineStart}` : `L${lineStart}–${lineEnd}`;
    }
    const { charOffsetStart, charOffsetEnd } = row.anchor;
    return `c${charOffsetStart}–${charOffsetEnd}`;
  }
  if (row.anchor.kind === "html-element") {
    if (row.anchor.sourceHint) {
      const { lineStart, lineEnd } = row.anchor.sourceHint;
      return lineStart === lineEnd ? `L${lineStart}` : `L${lineStart}–${lineEnd}`;
    }
    return row.anchor.file;
  }
  const { lineStart, lineEnd } = row.anchor;
  return lineStart === lineEnd ? `L${lineStart}` : `L${lineStart}–${lineEnd}`;
}

interface DesiredNote {
  row: AnnotationRow;
  desiredTop: number;
}

// Walk notes top-to-bottom (reading order) and push each one down enough to
// clear the previous one's bottom edge plus the gap. Same algorithm as
// `packages/review-shell/src/MarginGutter.tsx::resolveCollisions`.
function resolveCollisions(
  desired: ReadonlyArray<DesiredNote>,
  heights: ReadonlyMap<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  let lastBottom = Number.NEGATIVE_INFINITY;
  for (const { row, desiredTop } of desired) {
    const height = heights.get(row.id) ?? FALLBACK_NOTE_HEIGHT;
    const top = Math.max(desiredTop, lastBottom + NOTE_GAP);
    out[row.id] = top;
    lastBottom = top + height;
  }
  return out;
}

export default function MarginGutter(): JSX.Element {
  const store = useReviewStore();
  const annotations = store((s) => s.annotations);
  const focusedId = store((s) => s.focusedAnnotationId);
  const setFocused = store((s) => s.setFocusedAnnotation);
  const { scrollContainer, annotationTops, scrollToAnnotation } = useDocumentScroll();

  // Track the document's scrollTop so notes can re-anchor as the user reads.
  // Re-attach when the published scroll element changes (paper switch).
  const [scrollTop, setScrollTop] = useState(() => scrollContainer?.scrollTop ?? 0);
  useEffect(() => {
    if (!scrollContainer) {
      setScrollTop(0);
      return;
    }
    setScrollTop(scrollContainer.scrollTop);
    const onScroll = (): void => setScrollTop(scrollContainer.scrollTop);
    scrollContainer.addEventListener("scroll", onScroll, { passive: true });
    return () => scrollContainer.removeEventListener("scroll", onScroll);
  }, [scrollContainer]);

  const noteRefs = useRef<Map<string, HTMLElement>>(new Map());
  const registerNoteRef = useCallback((id: string, el: HTMLElement | null): void => {
    if (el) noteRefs.current.set(id, el);
    else noteRefs.current.delete(id);
  }, []);

  const desiredNotes = useMemo<DesiredNote[]>(() => {
    const out: DesiredNote[] = [];
    for (const row of annotations) {
      const top = annotationTops.get(row.id);
      if (top === undefined) continue;
      out.push({ row, desiredTop: top - scrollTop });
    }
    out.sort((a, b) => a.desiredTop - b.desiredTop);
    return out;
  }, [annotations, annotationTops, scrollTop]);

  const [resolvedTops, setResolvedTops] = useState<Record<string, number>>({});
  useLayoutEffect(() => {
    const heights = new Map<string, number>();
    for (const [id, el] of noteRefs.current) heights.set(id, el.offsetHeight);
    const next = resolveCollisions(desiredNotes, heights);
    setResolvedTops((prev) => {
      const keys = Object.keys(next);
      if (Object.keys(prev).length !== keys.length) return next;
      for (const id of keys) if (prev[id] !== next[id]) return next;
      return prev;
    });
  }, [desiredNotes]);

  const onClickNote = useCallback(
    (id: string): void => {
      setFocused(id);
      scrollToAnnotation(id);
    },
    [setFocused, scrollToAnnotation],
  );

  return (
    <aside className="margin-gutter" aria-label="Margin notes">
      {desiredNotes.map(({ row, desiredTop }) => {
        const loc = locationLabel(row);
        const top = resolvedTops[row.id] ?? desiredTop;
        const isFocused = focusedId === row.id;
        return (
          <button
            key={row.id}
            type="button"
            className="margin-note"
            data-focused={isFocused ? "true" : undefined}
            style={{ top }}
            onClick={() => onClickNote(row.id)}
            ref={(el) => registerNoteRef(row.id, el)}
          >
            <span
              className="margin-note__cat cat-tooltip"
              data-cat-tooltip={descriptionFor(row.category)}
            >
              {row.category}
            </span>
            {loc !== "" ? <span className="margin-note__page">{loc}</span> : null}
            {row.note && <span className="margin-note__body">{row.note}</span>}
          </button>
        );
      })}
    </aside>
  );
}
