import type { ChangeEvent, JSX } from "react";

interface Props {
  desk: string;
  onChange: (value: string) => void;
  onAdvance: () => void;
  onBack: () => void;
}

export default function FolioDesk({ desk, onChange, onAdvance, onBack }: Props): JSX.Element {
  return (
    <article className="folio">
      <header className="folio__head">
        <p className="folio__eyebrow">III.</p>
        <h1 className="folio__title">Name the desk.</h1>
      </header>
      <p className="folio__body">Optional. A word to see when you open the app.</p>
      <input
        className="folio__input"
        type="text"
        placeholder="e.g. Eastern light"
        value={desk}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onAdvance();
          }
        }}
      />
      <footer className="folio__foot">
        <button type="button" className="folio__back" onClick={onBack}>
          ← Back
        </button>
        <button type="button" className="folio__cta" onClick={onAdvance}>
          Continue <span aria-hidden="true">→</span>
        </button>
      </footer>
    </article>
  );
}
