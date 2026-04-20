import type { JSX } from "react";
import { useState } from "react";
import { fsListPdfs, openFolderPicker, openPdfPicker } from "../../ipc/commands";

interface Props {
  firstProject: boolean;
  onPickFolder: (root: string, label: string) => void;
  onPickFile: (root: string, label: string) => void;
  onPickStack: (root: string, label: string) => void;
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
  onPickStack,
  onBack,
}: Props): JSX.Element {
  const [busy, setBusy] = useState<null | "folder" | "file" | "stack">(null);
  const [error, setError] = useState<string | null>(null);

  async function pickFolder(): Promise<void> {
    setBusy("folder");
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
    setBusy("file");
    setError(null);
    try {
      const picked = await openPdfPicker();
      if (!picked) {
        setBusy(null);
        return;
      }
      const parent = picked.path.slice(
        0,
        Math.max(0, picked.path.length - picked.fileName.length - 1),
      );
      onPickFile(parent, stripExt(picked.fileName));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  }

  async function pickStack(): Promise<void> {
    setBusy("stack");
    setError(null);
    try {
      const picked = await openFolderPicker();
      if (!picked) {
        setBusy(null);
        return;
      }
      const pdfs = await fsListPdfs(picked.rootId);
      if (pdfs.length === 0) {
        setError("No PDFs found in this folder.");
        setBusy(null);
        return;
      }
      onPickStack(picked.path, labelFromRoot(picked.path));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  }

  return (
    <article className="folio">
      <header className="folio__head">
        <p className="folio__eyebrow">III.</p>
        <h1 className="folio__title">{firstProject ? "First project." : "New project."}</h1>
      </header>
      <p className="folio__body">Choose what you are bringing in.</p>
      <div className="folio__cards">
        <button
          type="button"
          className="folio__card"
          disabled={busy !== null}
          onClick={() => void pickFolder()}
        >
          <span className="folio__card-title">A paper I'm writing.</span>
          <span className="folio__card-sub">Pick folder →</span>
        </button>
        <button
          type="button"
          className="folio__card"
          disabled={busy !== null}
          onClick={() => void pickFile()}
        >
          <span className="folio__card-title">A paper I'm reviewing.</span>
          <span className="folio__card-sub">Pick file →</span>
        </button>
        <button
          type="button"
          className="folio__card"
          disabled={busy !== null}
          onClick={() => void pickStack()}
        >
          <span className="folio__card-title">A stack I'm reviewing.</span>
          <span className="folio__card-sub">Pick folder →</span>
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
