import type { JSX } from "react";
import EngineBlock from "../../components/engine-block";

interface Props {
  onAdvance: () => void;
  onBack: () => void;
}

export default function FolioEngines({ onAdvance, onBack }: Props): JSX.Element {
  return (
    <article className="folio folio--wide">
      <div className="folio__split">
        <div className="folio__split-text">
          <header className="folio__head">
            <p className="folio__eyebrow">II.</p>
            <h1 className="folio__title">Then, the press.</h1>
          </header>
          <p className="folio__body">
            Obelus can compile your source into PDF without touching your system. If you already
            have a TeX distribution or Typst on your machine, Obelus will find them. If not, it can
            install a self-contained copy now — or later, from Settings.
          </p>
        </div>
        <div className="folio__split-aside">
          <EngineBlock engine="typst" compact />
          <EngineBlock engine="tectonic" compact />
        </div>
      </div>
      <footer className="folio__foot">
        <button type="button" className="folio__back" onClick={onBack}>
          <span aria-hidden="true">←</span> Back
        </button>
        <button type="button" className="folio__cta" onClick={onAdvance}>
          Continue <span aria-hidden="true">→</span>
        </button>
      </footer>
    </article>
  );
}
