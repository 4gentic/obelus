import type { DiffHunkEmptyReason, DiffHunkRow } from "@obelus/repo";
import type { JSX } from "react";
import { useDiffStore } from "./diff-store-context";

const EMPTY_REASON_LABEL: Record<DiffHunkEmptyReason, string> = {
  praise: "Praise — nothing to change.",
  ambiguous: "Ambiguous — your call.",
  "structural-note": "Structural note.",
  "no-edit-requested": "No edit requested.",
};

function locationLabel(hunk: DiffHunkRow): string {
  if (hunk.file === "") return "—";
  return hunk.file.split("/").pop() ?? hunk.file;
}

function rationale(hunk: DiffHunkRow): { text: string; muted: boolean } {
  if (hunk.reviewerNotes !== "") return { text: hunk.reviewerNotes, muted: false };
  if (hunk.emptyReason !== null) return { text: EMPTY_REASON_LABEL[hunk.emptyReason], muted: true };
  return { text: "No rationale provided.", muted: true };
}

// What the reviewer found and why, one card per hunk — including the
// `reviewerNotes` rationale the diff view keeps hidden, and the praise /
// ambiguous notes that otherwise only surface on source-less papers.
export default function ReviewFindings({
  onOpenDiff,
}: {
  onOpenDiff: (hunkId: string) => void;
}): JSX.Element {
  const diffStore = useDiffStore();
  const hunks = diffStore((s) => s.hunks);

  if (hunks.length === 0) {
    return (
      <p className="review-column__hint">
        No findings yet. Run a review and the reviewer's notes land here.
      </p>
    );
  }

  return (
    <ul className="review-findings">
      {hunks.map((h) => {
        const note = rationale(h);
        const notesClass = `review-findings__notes${note.muted ? " review-findings__notes--muted" : ""}`;
        return (
          <li key={h.id} className="review-findings__item" data-state={h.state}>
            <header className="review-findings__head">
              <span className="review-findings__cat">{h.category ?? "note"}</span>
              <span className="review-findings__loc">{locationLabel(h)}</span>
              {h.patch !== "" && (
                <button
                  type="button"
                  className="review-findings__jump"
                  onClick={() => onOpenDiff(h.id)}
                >
                  view diff →
                </button>
              )}
            </header>
            <p className={notesClass}>{note.text}</p>
          </li>
        );
      })}
    </ul>
  );
}
