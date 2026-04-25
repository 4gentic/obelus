import type { PaperRubric } from "@obelus/repo";
import { type JSX, useCallback, useRef, useState } from "react";
import "./RubricPanel.css";

const MAX_RUBRIC_BYTES = 256 * 1024;

interface Props {
  rubric: PaperRubric | null;
  onChange: (rubric: PaperRubric | null) => Promise<void>;
}

type Mode = "idle" | "writing" | "viewing";

export default function RubricPanel({ rubric, onChange }: Props): JSX.Element {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>("idle");
  const [draft, setDraft] = useState("");

  const apply = useCallback(
    async (next: PaperRubric | null): Promise<void> => {
      setError(null);
      setBusy(true);
      try {
        await onChange(next);
        setMode("idle");
        setDraft("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save rubric.");
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [onChange],
  );

  const onFile = useCallback(
    async (file: File | null): Promise<void> => {
      if (!file) return;
      setError(null);
      if (file.size > MAX_RUBRIC_BYTES) {
        setError("That rubric file exceeds 256 KiB.");
        return;
      }
      try {
        const body = (await file.text()).trim();
        if (body.length === 0) {
          setError("That rubric file is empty.");
          return;
        }
        await apply({
          body,
          source: "file",
          label: file.name,
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not read rubric.");
      }
    },
    [apply],
  );

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
      await apply({
        body,
        source: "paste",
        label: "Pasted rubric",
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read clipboard.");
    }
  }, [apply]);

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
    try {
      await apply({
        body,
        source: "inline",
        label: rubric?.source === "inline" ? rubric.label : "Written rubric",
        updatedAt: new Date().toISOString(),
      });
    } catch {
      // error already surfaced by apply()
    }
  }, [apply, draft, rubric]);

  const editing = mode === "writing" || (mode === "viewing" && rubric?.source === "inline");
  const previewing = mode === "viewing" && rubric !== null && rubric.source !== "inline";
  const dirty = rubric === null ? draft.length > 0 : draft !== (rubric?.body ?? "");

  return (
    <section className="rubric-panel" aria-label="Review rubric">
      <div className="rubric-panel__head">
        <span className="rubric-panel__label">Rubric</span>
        {rubric ? (
          <span className="rubric-panel__chip" title={rubric.label}>
            {rubric.label} · {rubric.body.length.toLocaleString()} chars
          </span>
        ) : (
          <span className="rubric-panel__hint">Optional. Applied when you copy the prompt.</span>
        )}
      </div>

      {mode === "idle" ? (
        <div className="rubric-panel__actions">
          {rubric ? (
            <>
              <button
                type="button"
                className="rubric-panel__btn"
                disabled={busy}
                onClick={startView}
              >
                {rubric.source === "inline" ? "Edit" : "Preview"}
              </button>
              <button
                type="button"
                className="rubric-panel__btn"
                disabled={busy}
                onClick={() => void apply(null)}
              >
                Detach
              </button>
            </>
          ) : (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.txt,.markdown,text/markdown,text/plain"
                hidden
                onChange={(ev) => {
                  const f = ev.target.files?.[0] ?? null;
                  ev.target.value = "";
                  void onFile(f);
                }}
              />
              <button
                type="button"
                className="rubric-panel__btn"
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
              >
                Attach file…
              </button>
              <button
                type="button"
                className="rubric-panel__btn"
                disabled={busy}
                onClick={() => void onPaste()}
              >
                Paste
              </button>
              <button
                type="button"
                className="rubric-panel__btn"
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
              className="rubric-panel__btn"
              disabled={busy || !dirty}
              onClick={() => void saveDraft()}
            >
              Save
            </button>
            <button
              type="button"
              className="rubric-panel__btn"
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
              className="rubric-panel__btn"
              disabled={busy}
              onClick={cancelEditor}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="rubric-panel__error">{error}</p> : null}
    </section>
  );
}
