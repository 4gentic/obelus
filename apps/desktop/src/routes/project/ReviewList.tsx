import type { JSX } from "react";
import { useEffect, useRef } from "react";
import { useReviewStore } from "./store-context";
import { trimQuoteMiddle } from "./trim-quote";
export default function ReviewList(): JSX.Element {
  const store = useReviewStore();
  const annotations = store((s) => s.annotations);
  const focusedId = store((s) => s.focusedAnnotationId);
  const setFocused = store((s) => s.setFocusedAnnotation);
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
    return <p className="review-column__hint">No marks yet. Select text in the PDF to begin.</p>;
  }

  return (
    <ol className="review-list" ref={listRef}>
      {annotations.map((a) => (
        // biome-ignore lint/a11y/useKeyWithClickEvents: focus is driven by j/k in the review column; this click is a mouse-only shortcut.
        <li
          key={a.id}
          data-id={a.id}
          data-focused={focusedId === a.id ? "true" : undefined}
          className="review-list__item"
          onClick={() => setFocused(a.id)}
        >
          <header className="review-list__head">
            <span className="review-list__cat">{a.category}</span>
            <span className="review-list__page">p. {a.page}</span>
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
          {a.note && <p className="review-list__note">{a.note}</p>}
        </li>
      ))}
    </ol>
  );
}
