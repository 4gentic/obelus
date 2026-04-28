import type { AnnotationRow } from "@obelus/repo";
import { CategorySelect, NoteEditor } from "@obelus/review-shell";
import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import { markLocationLabel } from "./mark-location-label";
import { useReviewStore } from "./store-context";
import { trimQuoteMiddle } from "./trim-quote";

const INTERACTIVE_SELECTOR =
  ".cat-select__trigger, .cat-select__pop, textarea, .review-list__remove";

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
    <NoteEditor
      value={value}
      onChange={setValue}
      onCommit={(next) => {
        if (next !== initial) onCommit(next);
      }}
      placeholder="Note (optional)"
      ariaLabel={`note for mark ${annotationId}`}
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
        <div className="review-list__head-left">
          <span className="review-list__page">{markLocationLabel(a)}</span>
          {isResolved ? (
            <span className="review-list__cat review-list__cat--resolved">{a.category}</span>
          ) : (
            <CategorySelect
              value={a.category}
              onChange={(c) => void updateAnnotation(a.id, { category: c })}
              ariaLabel={`Change category for mark on ${markLocationLabel(a)}`}
            />
          )}
        </div>
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
