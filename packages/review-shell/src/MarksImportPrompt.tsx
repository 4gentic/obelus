import { type JSX, useEffect, useId, useRef } from "react";
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
// choice, not a modal. It can render below the fold of a scrolling marks column,
// so on mount it pulls itself into view and takes focus — without that, reviewers
// miss it and assume the import failed.
export default function MarksImportPrompt({
  incoming,
  existing,
  onReplace,
  onMerge,
  onCancel,
}: MarksImportPromptProps): JSX.Element {
  const ref = useRef<HTMLElement>(null);
  const bodyId = useId();

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    node.scrollIntoView({ block: "center", behavior: motion?.matches ? "auto" : "smooth" });
    node.focus({ preventScroll: true });
  }, []);

  return (
    <aside
      ref={ref}
      className="marks-import-prompt"
      aria-label="Resolve marks import"
      aria-describedby={bodyId}
      aria-live="polite"
      tabIndex={-1}
    >
      <p id={bodyId} className="marks-import-prompt__body">
        Importing {marks(incoming)} onto a paper that already has {marks(existing)}. Replace all
        existing marks, or add the imported ones alongside?
      </p>
      <div className="marks-import-prompt__actions">
        <button
          type="button"
          className="marks-import-prompt__choice marks-import-prompt__choice--replace"
          onClick={onReplace}
        >
          Replace all
        </button>
        <button type="button" className="marks-import-prompt__choice" onClick={onMerge}>
          Add alongside
        </button>
        <button type="button" className="marks-import-prompt__dismiss" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </aside>
  );
}
