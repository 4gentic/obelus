import type { JSX } from "react";
import { useReviewStore } from "./store-context";
export default function MarginGutter(): JSX.Element {
  const store = useReviewStore();
  const annotations = store((s) => s.annotations);

  return (
    <aside className="margin-gutter" aria-label="Margin notes">
      {annotations.map((a) => (
        <div key={a.id} className="margin-note">
          <span className="margin-note__cat">{a.category}</span>
          <span className="margin-note__page">p. {a.page}</span>
          {a.note && <p className="margin-note__body">{a.note}</p>}
        </div>
      ))}
    </aside>
  );
}
