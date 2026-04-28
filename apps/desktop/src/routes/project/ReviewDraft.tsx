import { NoteEditor } from "@obelus/review-shell";
import { type JSX, useEffect, useState } from "react";
import CategoryPicker from "./CategoryPicker";
import { useEnsureRevision } from "./ensure-revision-context";
import { useReviewStore } from "./store-context";
import { trimQuoteMiddle } from "./trim-quote";

export default function ReviewDraft(): JSX.Element | null {
  const store = useReviewStore();
  const draft = store((s) => s.selectedAnchor);
  const category = store((s) => s.draftCategory);
  const note = store((s) => s.draftNote);
  const setCategory = store((s) => s.setDraftCategory);
  const setNote = store((s) => s.setDraftNote);
  const save = store((s) => s.saveAnnotation);
  const discard = store((s) => s.setSelectedAnchor);
  const ensureRevision = useEnsureRevision();
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    if (category || !draft) setSaveError(false);
  }, [category, draft]);

  if (!draft) return null;

  function handleSave(): void {
    if (!draft) return;
    if (!category) {
      setSaveError(true);
      return;
    }
    void save({
      draft,
      category,
      note,
      ...(ensureRevision ? { ensureRevision } : {}),
    });
  }

  return (
    <div className="review-draft">
      <p className="review-draft__hint">Pick a category and save, or discard this selection.</p>
      <blockquote className="review-draft__quote">{trimQuoteMiddle(draft.quote)}</blockquote>
      <CategoryPicker
        value={category}
        onChange={setCategory}
        invalid={saveError}
        errorId="review-draft-error"
      />
      {saveError ? (
        <p className="review-draft__error" id="review-draft-error" role="alert">
          Pick a category to save this mark.
        </p>
      ) : null}
      <NoteEditor value={note} onChange={setNote} placeholder="Note (optional)" />
      <div className="review-draft__actions">
        <button type="button" className="btn btn--primary" onClick={handleSave}>
          Save mark
        </button>
        <button type="button" className="btn btn--subtle" onClick={() => discard(null)}>
          Discard
        </button>
      </div>
    </div>
  );
}
