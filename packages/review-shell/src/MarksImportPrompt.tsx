import type { JSX } from "react";
import "./MarksImportPrompt.css";

export interface MarksImportPromptProps {
  // Marks carried by the archive being imported.
  incoming: number;
  // Marks already on the target revision (always ≥ 1 — the prompt is skipped
  // when the paper has none, since there is nothing to replace).
  existing: number;
  onReplace: () => void;
  onMerge: () => void;
  onCancel: () => void;
}

const marks = (n: number): string => (n === 1 ? "1 mark" : `${n} marks`);

// Shown by both surfaces when a marks import lands on a paper that already has
// marks: replace what's there, or add the imports alongside. An inline editorial
// choice, not a modal — same banner language as TrustBanner.
export default function MarksImportPrompt({
  incoming,
  existing,
  onReplace,
  onMerge,
  onCancel,
}: MarksImportPromptProps): JSX.Element {
  return (
    <aside className="marks-import-prompt" role="status" aria-live="polite">
      <p className="marks-import-prompt__body">
        Importing {marks(incoming)}. This paper already has {marks(existing)}. Remove the existing
        ones first, or add the imported marks alongside them?
      </p>
      <div className="marks-import-prompt__actions">
        <button type="button" className="marks-import-prompt__primary" onClick={onReplace}>
          Replace all
        </button>
        <button type="button" className="marks-import-prompt__secondary" onClick={onMerge}>
          Add alongside
        </button>
        <button type="button" className="marks-import-prompt__dismiss" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </aside>
  );
}
