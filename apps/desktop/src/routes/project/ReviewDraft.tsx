import type { JSX } from "react";
import CategoryPicker from "./CategoryPicker";
import { useReviewStore } from "./store-context";
export default function ReviewDraft(): JSX.Element | null {
  const store = useReviewStore();
  const draft = store((s) => s.selectedAnchor);
  const category = store((s) => s.draftCategory);
  const note = store((s) => s.draftNote);
  const setCategory = store((s) => s.setDraftCategory);
  const setNote = store((s) => s.setDraftNote);
  const save = store((s) => s.saveAnnotation);
  const discard = store((s) => s.setSelectedAnchor);

  if (!draft) return null;

  function handleSave(): void {
    if (!draft || !category) return;
    void save({ draft, category, note });
  }

  return (
    <div className="review-draft">
      <blockquote className="review-draft__quote">{draft.quote}</blockquote>
      <CategoryPicker value={category} onChange={setCategory} />
      <textarea
        className="review-draft__note"
        placeholder="Note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={4}
      />
      <div className="review-draft__actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={!category}
          onClick={handleSave}
        >
          Save mark
        </button>
        <button type="button" className="btn btn--subtle" onClick={() => discard(null)}>
          Discard
        </button>
      </div>
    </div>
  );
}
