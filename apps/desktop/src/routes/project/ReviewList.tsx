import type { AnnotationRow } from "@obelus/repo";
import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import CategoryPicker from "./CategoryPicker";
import { useReviewStore } from "./store-context";
import { trimQuoteMiddle } from "./trim-quote";

const INTERACTIVE_SELECTOR = ".category-picker, textarea, .review-list__remove";

// Renders the mark's location chip. PDF anchors → "p. N"; source anchors → a
// line range; html anchors → source-hint line range when paired, else char
// offset range. Switches on the anchor's discriminant.
function markLocationLabel(a: AnnotationRow): string {
  if (a.anchor.kind === "source") {
    const { lineStart, lineEnd } = a.anchor;
    return lineStart === lineEnd ? `L${lineStart}` : `L${lineStart}–${lineEnd}`;
  }
  if (a.anchor.kind === "html") {
    if (a.anchor.sourceHint) {
      const { lineStart, lineEnd } = a.anchor.sourceHint;
      return lineStart === lineEnd ? `L${lineStart}` : `L${lineStart}–${lineEnd}`;
    }
    const { charOffsetStart, charOffsetEnd } = a.anchor;
    return `c${charOffsetStart}–${charOffsetEnd}`;
  }
  if (a.anchor.kind === "html-element") {
    if (a.anchor.sourceHint) {
      const { lineStart, lineEnd } = a.anchor.sourceHint;
      return lineStart === lineEnd ? `L${lineStart}` : `L${lineStart}–${lineEnd}`;
    }
    return a.anchor.file;
  }
  return `p. ${a.anchor.page}`;
}

function NoteField({
  annotationId,
  initial,
  onCommit,
}: {
  annotationId: string;
  initial: string;
  onCommit: (next: string) => void;
}): JSX.Element {
  const [value, setValue] = useState(initial);

  useEffect(() => {
    setValue(initial);
  }, [initial]);

  return (
    <textarea
      className="review-list__note review-list__note--editable"
      placeholder="Note (optional)"
      value={value}
      onChange={(ev) => setValue(ev.target.value)}
      onBlur={() => {
        if (value !== initial) onCommit(value);
      }}
      rows={2}
      aria-label={`note for mark ${annotationId}`}
    />
  );
}

function ReviewItem({
  a,
  focused,
  setFocused,
  updateAnnotation,
  deleteAnnotation,
}: {
  a: AnnotationRow;
  focused: boolean;
  setFocused: (id: string | null) => void;
  updateAnnotation: (id: string, patch: Partial<AnnotationRow>) => Promise<void>;
  deleteAnnotation: (id: string) => Promise<void>;
}): JSX.Element {
  const isResolved = a.resolvedInEditId !== undefined;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: focus is driven by j/k in the review column; this click is a mouse-only shortcut.
    <li
      data-id={a.id}
      data-focused={focused ? "true" : undefined}
      data-category={a.category}
      className="review-list__item"
      onClick={(ev) => {
        if ((ev.target as HTMLElement).closest(INTERACTIVE_SELECTOR)) return;
        setFocused(a.id);
      }}
    >
      <header className="review-list__head">
        <span className="review-list__page">{markLocationLabel(a)}</span>
        <button
          type="button"
          className="review-list__remove"
          onClick={(ev) => {
            ev.stopPropagation();
            void deleteAnnotation(a.id);
          }}
          aria-label={`remove mark ${a.id}`}
        >
          ×
        </button>
      </header>
      {isResolved ? (
        <p className="review-list__cat review-list__cat--resolved">{a.category}</p>
      ) : (
        <CategoryPicker
          name={`cat-${a.id}`}
          value={a.category}
          onChange={(c) => void updateAnnotation(a.id, { category: c })}
        />
      )}
      <blockquote className="review-list__quote">{trimQuoteMiddle(a.quote)}</blockquote>
      {isResolved ? (
        a.note ? (
          <p className="review-list__note">{a.note}</p>
        ) : null
      ) : (
        <NoteField
          annotationId={a.id}
          initial={a.note}
          onCommit={(note) => void updateAnnotation(a.id, { note })}
        />
      )}
    </li>
  );
}

export default function ReviewList(): JSX.Element {
  const store = useReviewStore();
  const annotations = store((s) => s.annotations);
  const focusedId = store((s) => s.focusedAnnotationId);
  const setFocused = store((s) => s.setFocusedAnnotation);
  const updateAnnotation = store((s) => s.updateAnnotation);
  const deleteAnnotation = store((s) => s.deleteAnnotation);
  const listRef = useRef<HTMLOListElement | null>(null);

  useEffect(() => {
    if (!focusedId) return;
    const root = listRef.current;
    if (!root) return;
    const target = root.querySelector<HTMLElement>(`[data-id="${focusedId}"]`);
    if (target) target.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusedId]);

  if (annotations.length === 0) {
    return <p className="review-column__hint">No marks yet. Select text to begin.</p>;
  }

  return (
    <ol className="review-list" ref={listRef}>
      {annotations.map((a) => (
        <ReviewItem
          key={a.id}
          a={a}
          focused={focusedId === a.id}
          setFocused={setFocused}
          updateAnnotation={updateAnnotation}
          deleteAnnotation={deleteAnnotation}
        />
      ))}
    </ol>
  );
}
