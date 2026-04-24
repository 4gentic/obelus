import type { JSX } from "react";
import { useState } from "react";
import { openFolderPicker, openPaperPicker } from "../../ipc/commands";

interface Props {
  firstProject: boolean;
  onPickFolder: (root: string, label: string) => void;
  onPickFile: (root: string, label: string, relPath: string) => void;
  onBack: () => void;
}

function labelFromRoot(root: string): string {
  const parts = root.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "Untitled";
}

function stripExt(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return name;
  return name.slice(0, dot);
}

export default function FolioProject({
  firstProject,
  onPickFolder,
  onPickFile,
  onBack,
}: Props): JSX.Element {
  const [busy, setBusy] = useState<null | "writer" | "reviewer">(null);
  const [error, setError] = useState<string | null>(null);

  async function pickFolder(): Promise<void> {
    setBusy("writer");
    setError(null);
    try {
      const picked = await openFolderPicker();
      if (!picked) {
        setBusy(null);
        return;
      }
      onPickFolder(picked.path, labelFromRoot(picked.path));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  }

  async function pickFile(): Promise<void> {
    setBusy("reviewer");
    setError(null);
    try {
      const picked = await openPaperPicker();
      if (!picked) {
        setBusy(null);
        return;
      }
      const parent = picked.path.slice(
        0,
        Math.max(0, picked.path.length - picked.fileName.length - 1),
      );
      onPickFile(parent, stripExt(picked.fileName), picked.fileName);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  }

  return (
    <article className="folio">
      <header className="folio__head">
        <p className="folio__eyebrow">IV.</p>
        <h1 className="folio__title">{firstProject ? "First project." : "New project."}</h1>
      </header>
      <p className="folio__body">Who are you, on this paper?</p>
      <div className="folio__cards">
        <button
          type="button"
          className="folio__card"
          disabled={busy !== null}
          onClick={() => void pickFolder()}
        >
          <span className="folio__card-title">I'm a writer.</span>
          <span className="folio__card-legend">
            For authors and co-authors. Open the folder that holds your paper source — LaTeX,
            Markdown, or Typst — and mark the rendered PDF for revision.
          </span>
          <span className="folio__card-sub">Pick folder →</span>
        </button>
        <button
          type="button"
          className="folio__card"
          disabled={busy !== null}
          onClick={() => void pickFile()}
        >
          <span className="folio__card-title">I'm a reviewer.</span>
          <span className="folio__card-legend">
            For critics and reviewers. Open a single PDF or Markdown file, mark what needs
            attention, and draft a reviewer's letter.
          </span>
          <span className="folio__card-sub">Pick paper →</span>
        </button>
      </div>
      {error ? (
        <p className="folio__error" role="alert">
          {error}
        </p>
      ) : null}
      <footer className="folio__foot">
        <button type="button" className="folio__back" onClick={onBack}>
          ← Back
        </button>
      </footer>
    </article>
  );
}
