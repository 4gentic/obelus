import type { PaperEditRow } from "@obelus/repo";
import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import { useInlineConfirm } from "./use-inline-confirm";

export type DraftEntryState = "current" | "past" | "future-faded" | "tombstoned";

export interface DraftEntryProps {
  draft: PaperEditRow;
  state: DraftEntryState;
  // Count of still-live descendants — used for the "faded (will be discarded)"
  // hint on rows above "you are here" and for the fold range math.
  discardedHint?: string;
  onOpen?: () => void | Promise<void>;
  onCompare?: () => void;
  onFold?: () => void | Promise<void>;
  onRename?: (next: string) => void | Promise<void>;
  onRecover?: () => void | Promise<void>;
  busy: boolean;
  dateLabel: string;
  absoluteDate: string;
}

export default function DraftEntry({
  draft,
  state,
  discardedHint,
  onOpen,
  onCompare,
  onFold,
  onRename,
  onRecover,
  busy,
  dateLabel,
  absoluteDate,
}: DraftEntryProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(draft.summary);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const foldConfirm = useInlineConfirm();
  const recoverConfirm = useInlineConfirm();

  useEffect(() => {
    setValue(draft.summary);
  }, [draft.summary]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const marker = markerFor(state);
  const className = [
    "draft-entry",
    `draft-entry--${state}`,
    state === "current" ? "draft-entry--accent" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const isBaseline = draft.kind === "baseline";
  const labelText = isBaseline ? "Draft 1" : `Draft ${draft.ordinal}`;
  const noteText = draft.summary || (isBaseline ? "the paper as you opened it." : "untitled");

  async function commitRename() {
    const next = value.trim();
    setEditing(false);
    if (next !== draft.summary) await onRename?.(next);
  }

  return (
    <article className={className} aria-current={state === "current" ? "true" : undefined}>
      <span className="draft-entry__marker" aria-hidden="true">
        {marker}
      </span>
      <div className="draft-entry__body">
        <header className="draft-entry__header">
          <span className="draft-entry__label">{labelText}</span>
          <span className="draft-entry__dot" aria-hidden="true">
            ·
          </span>
          <time className="draft-entry__time" title={absoluteDate}>
            {dateLabel}
          </time>
        </header>

        {editing ? (
          <input
            ref={inputRef}
            className="draft-entry__note-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => void commitRename()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void commitRename();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setValue(draft.summary);
                setEditing(false);
              }
            }}
          />
        ) : (
          <p className="draft-entry__note">{noteText}</p>
        )}

        {discardedHint && <p className="draft-entry__hint">{discardedHint}</p>}

        <footer className="draft-entry__actions">
          {(state === "past" || state === "future-faded") && onOpen && (
            <button
              type="button"
              className="draft-entry__btn"
              disabled={busy}
              onClick={() => void onOpen()}
            >
              open
            </button>
          )}
          {onCompare && draft.parentEditId !== null && (
            <button type="button" className="draft-entry__btn" disabled={busy} onClick={onCompare}>
              compare with previous
            </button>
          )}
          {state !== "tombstoned" && onRename && !editing && (
            <button
              type="button"
              className="draft-entry__btn"
              disabled={busy}
              onClick={() => setEditing(true)}
            >
              rename
            </button>
          )}
          {state === "past" && onFold && (
            <button
              type="button"
              className={
                foldConfirm.armed ? "draft-entry__btn draft-entry__btn--danger" : "draft-entry__btn"
              }
              disabled={busy}
              onClick={() => {
                if (foldConfirm.armed) {
                  void foldConfirm.confirm(() => onFold());
                } else {
                  foldConfirm.arm();
                }
              }}
              {...foldConfirm.bind()}
            >
              {foldConfirm.armed ? "click to confirm" : "fold"}
            </button>
          )}
          {state === "tombstoned" && onRecover && (
            <button
              type="button"
              className={
                recoverConfirm.armed
                  ? "draft-entry__btn draft-entry__btn--accent"
                  : "draft-entry__btn"
              }
              disabled={busy}
              onClick={() => {
                if (recoverConfirm.armed) {
                  void recoverConfirm.confirm(() => onRecover());
                } else {
                  recoverConfirm.arm();
                }
              }}
              {...recoverConfirm.bind()}
            >
              {recoverConfirm.armed ? "click to confirm" : "recover"}
            </button>
          )}
        </footer>
      </div>
    </article>
  );
}

function markerFor(state: DraftEntryState): string {
  switch (state) {
    case "current":
      return "●";
    case "past":
      return "○";
    case "future-faded":
      return "○";
    case "tombstoned":
      return "⌇";
  }
}
