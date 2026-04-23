import type { DiffHunkRow } from "@obelus/repo";
import type { JSX } from "react";
import { type CSSProperties, useEffect, useRef } from "react";
import { buildDisplayLines } from "./patch-with-context";

const CONTEXT_LINES = 3;

interface Props {
  hunk: DiffHunkRow;
  indexInFile: number;
  totalInFile: number;
  sourceText: string | null;
  hasSources: boolean;
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

function DiffLines({
  patch,
  sourceText,
  emptyVariant,
}: {
  patch: string;
  sourceText: string | null;
  emptyVariant: "no-sources" | "flagged";
}): JSX.Element {
  const display = buildDisplayLines(patch, sourceText, CONTEXT_LINES);
  if (display.length === 0) {
    const message =
      emptyVariant === "no-sources"
        ? "Note only — this paper has no source files to patch."
        : "No patch (reviewer skipped or flagged).";
    return <p className="diff-block__empty">{message}</p>;
  }
  return (
    <pre className="diff-block__patch">
      {display.map((line, i) => {
        const cls =
          line.kind === "header"
            ? "diff-line diff-line--hunk"
            : line.kind === "old"
              ? "diff-line diff-line--old"
              : line.kind === "new"
                ? "diff-line diff-line--new"
                : "diff-line diff-line--ctx";
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are static per render; raw content is insufficient because identical lines may repeat inside a single hunk.
          <div key={`${i}:${line.text}`} className={cls}>
            {line.text}
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
    sourceText,
    hasSources,
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

  const isNoteOnly = hunk.ambiguous && !hasSources;
  const isTrulyAmbiguous = hunk.ambiguous && hasSources;

  return (
    <article
      ref={ref}
      className={`diff-block hunk-block ${focused ? "hunk-block--focused" : ""} ${stateClass}${isTrulyAmbiguous ? " diff-block--ambiguous" : ""}`}
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
        {isNoteOnly && <span className="diff-block__tag">note</span>}
        {isTrulyAmbiguous && <span className="diff-block__tag">ambiguous</span>}
        <span className="hunk-block__state">{hunk.state}</span>
      </header>
      <DiffLines
        patch={hunk.modifiedPatchText ?? hunk.patch}
        sourceText={sourceText}
        emptyVariant={isNoteOnly ? "no-sources" : "flagged"}
      />
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
