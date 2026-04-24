import { descriptionFor } from "@obelus/categories";
import type { AnnotationRow } from "@obelus/repo";
import type { JSX } from "react";
import { useReviewStore } from "./store-context";

// Row-agnostic "where in the paper" label. PDF rows carry `page`; source rows
// (markdown, future html) carry `sourceAnchor.lineStart/lineEnd`. Mirrors
// `packages/review-shell/src/ReviewPane.tsx::locationLabel`.
function locationLabel(row: AnnotationRow): string {
  if (row.page !== undefined) return `p. ${row.page}`;
  if (row.sourceAnchor) {
    const { lineStart, lineEnd } = row.sourceAnchor;
    return lineStart === lineEnd ? `L${lineStart}` : `L${lineStart}–${lineEnd}`;
  }
  return "";
}

export default function MarginGutter(): JSX.Element {
  const store = useReviewStore();
  const annotations = store((s) => s.annotations);

  return (
    <aside className="margin-gutter" aria-label="Margin notes">
      {annotations.map((a) => {
        const loc = locationLabel(a);
        return (
          <div key={a.id} className="margin-note">
            <span
              className="margin-note__cat cat-tooltip"
              data-cat-tooltip={descriptionFor(a.category)}
            >
              {a.category}
            </span>
            {loc !== "" ? <span className="margin-note__page">{loc}</span> : null}
            {a.note && <p className="margin-note__body">{a.note}</p>}
          </div>
        );
      })}
    </aside>
  );
}
