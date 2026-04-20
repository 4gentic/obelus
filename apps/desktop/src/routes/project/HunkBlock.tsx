import type { DiffHunkRow } from "@obelus/repo";
import type { JSX } from "react";
import { type CSSProperties, useEffect, useRef } from "react";

interface Props {
  hunk: DiffHunkRow;
  indexInFile: number;
  totalInFile: number;
  focused: boolean;
  editing: boolean;
  editingText: string;
  noting: boolean;
  noteText: string;
  onFocus: () => void;
  onAccept: () => void;
  onReject: () => void;
  onStartEdit: () => void;
  onEditChange: (text: string) => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onStartNote: () => void;
  onNoteChange: (text: string) => void;
  onCommitNote: () => void;
  onCancelNote: () => void;
}

function DiffLines({ patch }: { patch: string }): JSX.Element {
  const lines = patch === "" ? [] : patch.split("\n");
  if (lines.length === 0) {
    return <p className="diff-block__empty">No patch (reviewer skipped or flagged).</p>;
  }
  return (
    <pre className="diff-block__patch">
      {lines.map((raw, i) => {
        let cls = "diff-line";
        if (raw.startsWith("@@")) cls = "diff-line diff-line--hunk";
        else if (raw.startsWith("-") && !raw.startsWith("---")) cls = "diff-line diff-line--old";
        else if (raw.startsWith("+") && !raw.startsWith("+++")) cls = "diff-line diff-line--new";
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are static per render; raw content is insufficient because identical lines may repeat inside a single hunk.
          <div key={`${i}:${raw}`} className={cls}>
            {raw}
          </div>
        );
      })}
    </pre>
  );
}

export default function HunkBlock(props: Props): JSX.Element {
  const {
    hunk,
    indexInFile,
    totalInFile,
    focused,
    editing,
    editingText,
    noting,
    noteText,
    onFocus,
    onAccept,
    onReject,
    onStartEdit,
    onEditChange,
    onCommitEdit,
    onCancelEdit,
    onStartNote,
    onNoteChange,
    onCommitNote,
    onCancelNote,
  } = props;
  const ref = useRef<HTMLElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focused]);

  useEffect(() => {
    if (editing) editRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (noting) noteRef.current?.focus();
  }, [noting]);

  const stateClass =
    hunk.state === "accepted"
      ? "hunk-block--accepted"
      : hunk.state === "rejected"
        ? "hunk-block--rejected"
        : hunk.state === "modified"
          ? "hunk-block--modified"
          : "";

  return (
    <article
      ref={ref}
      className={`diff-block hunk-block ${focused ? "hunk-block--focused" : ""} ${stateClass}${hunk.ambiguous ? " diff-block--ambiguous" : ""}`}
      style={{ "--ordinal": hunk.ordinal } as CSSProperties}
      onClick={onFocus}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onFocus();
        }
      }}
      tabIndex={-1}
    >
      <header className="diff-block__head hunk-block__head">
        <span className="hunk-block__ord">
          hunk {indexInFile + 1}/{totalInFile}
        </span>
        <span className="diff-block__cat">{hunk.category ?? "—"}</span>
        {hunk.ambiguous && <span className="diff-block__tag">ambiguous</span>}
        <span className="hunk-block__state">{hunk.state}</span>
      </header>
      <DiffLines patch={hunk.modifiedPatchText ?? hunk.patch} />
      {editing ? (
        <div className="hunk-block__edit">
          <textarea
            ref={editRef}
            className="hunk-block__textarea"
            value={editingText}
            onChange={(e) => onEditChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                onCommitEdit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onCancelEdit();
              }
            }}
            rows={Math.min(16, Math.max(4, editingText.split("\n").length + 1))}
            aria-label="Edit patch text"
          />
          <div className="hunk-block__actions">
            <button type="button" className="btn btn--subtle" onClick={onCancelEdit}>
              Cancel (Esc)
            </button>
            <button type="button" className="btn btn--primary" onClick={onCommitEdit}>
              Save (⌘↵)
            </button>
          </div>
        </div>
      ) : noting ? (
        <div className="hunk-block__edit">
          <textarea
            ref={noteRef}
            className="hunk-block__textarea"
            value={noteText}
            onChange={(e) => onNoteChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                onCommitNote();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onCancelNote();
              }
            }}
            rows={4}
            placeholder="Push back on this hunk. Included in the next pass."
            aria-label="Comment for next pass"
          />
          <div className="hunk-block__actions">
            <button type="button" className="btn btn--subtle" onClick={onCancelNote}>
              Cancel (Esc)
            </button>
            <button type="button" className="btn btn--primary" onClick={onCommitNote}>
              Save (⌘↵)
            </button>
          </div>
        </div>
      ) : (
        <div className="hunk-block__actions">
          <button type="button" className="btn btn--subtle" onClick={onAccept}>
            accept · a
          </button>
          <button type="button" className="btn btn--subtle" onClick={onReject}>
            reject · r
          </button>
          <button type="button" className="btn btn--subtle" onClick={onStartEdit}>
            edit · e
          </button>
          <button type="button" className="btn btn--subtle" onClick={onStartNote}>
            note · n
          </button>
          {hunk.noteText !== "" && (
            <span className="hunk-block__note-flag" title={hunk.noteText}>
              has note
            </span>
          )}
        </div>
      )}
    </article>
  );
}
