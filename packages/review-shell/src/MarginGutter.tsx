import type { AnnotationRow } from "@obelus/repo";
import type { JSX, Ref } from "react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import MarginNote from "./MarginNote";

const NOTE_GAP = 8;
const FALLBACK_NOTE_HEIGHT = 64;

type MarginGutterProps = {
  annotations: ReadonlyArray<AnnotationRow>;
  annotationTops: ReadonlyMap<string, number>;
  gutterRef: Ref<HTMLElement>;
  gutterOffsetTop: number;
  onSelectMark: (id: string) => void;
};

type DesiredNote = {
  row: AnnotationRow;
  desiredTop: number;
};

// Walk notes top-to-bottom (reading order) and push each one down enough to
// clear the previous one's bottom edge plus the gap. Measurements come from
// refs so the caller sees actual heights, not a constant estimate.
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

export default function MarginGutter({
  annotations,
  annotationTops,
  gutterRef,
  gutterOffsetTop,
  onSelectMark,
}: MarginGutterProps): JSX.Element {
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
      out.push({ row, desiredTop: top - gutterOffsetTop });
    }
    out.sort((a, b) => a.desiredTop - b.desiredTop);
    return out;
  }, [annotations, annotationTops, gutterOffsetTop]);

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

  return (
    <aside className="review-shell__gutter" ref={gutterRef} aria-label="Margin notes">
      {desiredNotes.map(({ row, desiredTop }) => (
        <MarginNote
          key={row.id}
          annotation={row}
          top={resolvedTops[row.id] ?? desiredTop}
          onSelect={onSelectMark}
          onRef={registerNoteRef}
        />
      ))}
    </aside>
  );
}

export { resolveCollisions };
