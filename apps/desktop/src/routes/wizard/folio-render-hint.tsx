import type { JSX } from "react";

interface Props {
  label: string;
  firstProject: boolean;
  onFinish: () => void;
}

// Writer-mode post-pick confirmation. Source rendering itself lands in Phase 5;
// here we only capture the user's intent so Phase 5 can honor it.
export default function FolioRenderHint({ label, firstProject, onFinish }: Props): JSX.Element {
  return (
    <article className="folio">
      <header className="folio__head">
        <p className="folio__eyebrow">III.</p>
        <h1 className="folio__title">The desk is set.</h1>
      </header>
      <p className="folio__body">
        {firstProject ? (
          <>
            <strong>{label}</strong> is your first project. Source rendering arrives in a later
            phase; for now we hold the folder and stay out of the way.
          </>
        ) : (
          <>
            <strong>{label}</strong> is in. Source rendering arrives in a later phase; for now we
            hold the folder and stay out of the way.
          </>
        )}
      </p>
      <footer className="folio__foot">
        <button type="button" className="folio__cta" onClick={onFinish}>
          Open when ready <span aria-hidden="true">→</span>
        </button>
      </footer>
    </article>
  );
}
