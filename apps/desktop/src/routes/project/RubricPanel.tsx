import type { PaperRow, PaperRubric } from "@obelus/repo";
import { type JSX, useCallback, useEffect, useState } from "react";
import { openRubricPicker } from "../../ipc/commands";
import { useProject } from "./context";

const MAX_RUBRIC_BYTES = 256 * 1024;

interface Props {
  paper: PaperRow | null;
}

type Mode = "idle" | "writing" | "viewing";

export default function RubricPanel({ paper }: Props): JSX.Element | null {
  const { repo } = useProject();
  const [rubric, setRubric] = useState<PaperRubric | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>("idle");
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!paper) {
      setRubric(null);
      setError(null);
      setMode("idle");
      setDraft("");
      return;
    }
    setRubric(paper.rubric ?? null);
    setError(null);
    setMode("idle");
    setDraft("");
  }, [paper]);

  const persist = useCallback(
    async (next: PaperRubric | null): Promise<void> => {
      if (!paper) return;
      setError(null);
      setBusy(true);
      try {
        await repo.papers.setRubric(paper.id, next);
        setRubric(next);
        setMode("idle");
        setDraft("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save rubric.");
      } finally {
        setBusy(false);
      }
    },
    [paper, repo],
  );

  const onAttachFile = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const picked = await openRubricPicker();
      if (!picked) return;
      const body = picked.content.trim();
      if (body.length === 0) {
        setError("That rubric file is empty.");
        return;
      }
      await persist({
        body,
        source: "file",
        label: picked.name,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read rubric.");
    }
  }, [persist]);

  const onPaste = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const text = await navigator.clipboard.readText();
      const body = text.trim();
      if (body.length === 0) {
        setError("Clipboard is empty.");
        return;
      }
      const bytes = new TextEncoder().encode(body).length;
      if (bytes > MAX_RUBRIC_BYTES) {
        setError("Pasted rubric exceeds 256 KiB.");
        return;
      }
      await persist({
        body,
        source: "paste",
        label: "Pasted rubric",
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read clipboard.");
    }
  }, [persist]);

  const startWrite = useCallback((): void => {
    setError(null);
    setDraft("");
    setMode("writing");
  }, []);

  const startView = useCallback((): void => {
    setError(null);
    setDraft(rubric?.body ?? "");
    setMode("viewing");
  }, [rubric]);

  const cancelEditor = useCallback((): void => {
    setError(null);
    setDraft("");
    setMode("idle");
  }, []);

  const saveDraft = useCallback(async (): Promise<void> => {
    const body = draft.trim();
    if (body.length === 0) {
      setError("Rubric is empty.");
      return;
    }
    const bytes = new TextEncoder().encode(body).length;
    if (bytes > MAX_RUBRIC_BYTES) {
      setError("Rubric exceeds 256 KiB.");
      return;
    }
    await persist({
      body,
      source: "inline",
      label: rubric?.source === "inline" ? rubric.label : "Written rubric",
      updatedAt: new Date().toISOString(),
    });
  }, [draft, persist, rubric]);

  const onDetach = useCallback((): void => {
    void persist(null);
  }, [persist]);

  if (!paper) return null;

  const editing = mode === "writing" || (mode === "viewing" && rubric?.source === "inline");
  const previewing = mode === "viewing" && rubric !== null && rubric.source !== "inline";
  const dirty = rubric === null ? draft.length > 0 : draft !== (rubric?.body ?? "");

  return (
    <div className="rubric-panel">
      <div className="rubric-panel__head">
        <span className="rubric-panel__label">Rubric</span>
        {rubric ? (
          <span className="rubric-panel__chip" title={rubric.label}>
            {rubric.label} · {rubric.body.length.toLocaleString()} chars
          </span>
        ) : (
          <span className="rubric-panel__hint">Optional. Applied at draft time.</span>
        )}
      </div>

      {mode === "idle" ? (
        <div className="rubric-panel__actions">
          {rubric ? (
            <>
              <button type="button" className="btn btn--subtle" disabled={busy} onClick={startView}>
                {rubric.source === "inline" ? "Edit" : "Preview"}
              </button>
              <button type="button" className="btn btn--subtle" disabled={busy} onClick={onDetach}>
                Detach
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn btn--subtle"
                disabled={busy}
                onClick={() => void onAttachFile()}
              >
                Attach file…
              </button>
              <button
                type="button"
                className="btn btn--subtle"
                disabled={busy}
                onClick={() => void onPaste()}
              >
                Paste
              </button>
              <button
                type="button"
                className="btn btn--subtle"
                disabled={busy}
                onClick={startWrite}
              >
                Write…
              </button>
            </>
          )}
        </div>
      ) : null}

      {editing ? (
        <div className="rubric-panel__editor">
          <textarea
            className="rubric-panel__textarea"
            value={draft}
            onChange={(ev) => setDraft(ev.target.value)}
            placeholder={
              "## Novelty\n\nDoes the paper advance the state of the art?\n\n## Soundness\n\nAre the experiments well-controlled?"
            }
            spellCheck={false}
            disabled={busy}
            aria-label="Rubric body"
            rows={12}
          />
          <div className="rubric-panel__editor-actions">
            <button
              type="button"
              className="btn btn--subtle"
              disabled={busy || !dirty}
              onClick={() => void saveDraft()}
            >
              Save
            </button>
            <button
              type="button"
              className="btn btn--subtle"
              disabled={busy}
              onClick={cancelEditor}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {previewing && rubric ? (
        <div className="rubric-panel__editor">
          <pre className="rubric-panel__preview">{rubric.body}</pre>
          <div className="rubric-panel__editor-actions">
            <button
              type="button"
              className="btn btn--subtle"
              disabled={busy}
              onClick={cancelEditor}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="rubric-panel__error">{error}</p> : null}
    </div>
  );
}
