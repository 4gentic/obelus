import type { AnnotationRow, PaperRubric } from "@obelus/repo";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DraftInput } from "../../store/review-store";
import CategoryPicker from "./CategoryPicker";
import NoteEditor from "./NoteEditor";
import RubricPanel from "./RubricPanel";
import "./ReviewPane.css";

import type { JSX } from "react";

type Props = {
  annotations: AnnotationRow[];
  selectedAnchor: DraftInput | null;
  draftCategory: string | null;
  draftNote: string;
  focusedAnnotationId: string | null;
  rubric: PaperRubric | null;
  onSave: (input: { draft: DraftInput; category: string; note: string }) => Promise<void>;
  onDiscard: () => void;
  onDraftCategoryChange: (category: string | null) => void;
  onDraftNoteChange: (note: string) => void;
  onUpdateNote: (id: string, note: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onDeleteGroup: (groupId: string) => Promise<void>;
  onExportReview: () => Promise<string | null>;
  onExportRevise: () => Promise<string | null>;
  onExportMarkdown: () => void;
  onExportReviewMarkdown: () => void;
  onCopy: () => void;
  onCopyReview: () => void;
  onRubricChange: (rubric: PaperRubric | null) => Promise<void>;
  exportDisabled: boolean;
  statusMessage: string | null;
  statusTone: "idle" | "working" | "done" | "error";
};

type DisplayEntry =
  | { kind: "single"; row: AnnotationRow }
  | { kind: "group"; groupId: string; rows: AnnotationRow[] };

type AnnotationItemProps = {
  entry: DisplayEntry;
  focused: boolean;
  onUpdateNote: (id: string, note: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onDeleteGroup: (groupId: string) => Promise<void>;
};

function AnnotationItem({
  entry,
  focused,
  onUpdateNote,
  onDelete,
  onDeleteGroup,
}: AnnotationItemProps): JSX.Element {
  const first = entry.kind === "single" ? entry.row : (entry.rows[0] as AnnotationRow);
  const [local, setLocal] = useState(first.note);
  const category = first.category;
  const pageLabel =
    entry.kind === "single"
      ? `p. ${entry.row.page}`
      : `p. ${entry.rows.map((r) => r.page).join(", ")}`;
  const quoteNodes =
    entry.kind === "single" ? (
      <blockquote className="review-pane__item-quote">{entry.row.quote}</blockquote>
    ) : (
      <div className="review-pane__item-quotes">
        {entry.rows.map((r) => (
          <blockquote key={r.id} className="review-pane__item-quote">
            <span className="review-pane__item-quote-page">p. {r.page}</span>
            {r.quote}
          </blockquote>
        ))}
      </div>
    );

  return (
    <li
      className="review-pane__item"
      data-category={category}
      data-focused={focused ? "true" : "false"}
      data-kind={entry.kind}
    >
      <header className="review-pane__item-head">
        <span className="review-pane__item-cat">
          {category}
          {entry.kind === "group" ? (
            <span className="review-pane__item-link" title="Linked across pages">
              {" "}
              {"\u21C4"}
            </span>
          ) : null}
        </span>
        <span className="review-pane__item-page">{pageLabel}</span>
      </header>
      {quoteNodes}
      <NoteEditor
        value={local}
        onChange={setLocal}
        onCommit={(next) => {
          if (next !== first.note) void onUpdateNote(first.id, next);
        }}
        placeholder="Add a note"
      />
      <div className="review-pane__item-actions">
        <button
          type="button"
          className="review-pane__btn review-pane__btn--ghost"
          onClick={() => {
            if (entry.kind === "single") void onDelete(entry.row.id);
            else void onDeleteGroup(entry.groupId);
          }}
        >
          Remove
        </button>
      </div>
    </li>
  );
}

function buildDisplayEntries(rows: ReadonlyArray<AnnotationRow>): DisplayEntry[] {
  const sorted = [...rows].sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    const aStart = a.textItemRange.start[0];
    const bStart = b.textItemRange.start[0];
    return aStart - bStart;
  });
  const entries: DisplayEntry[] = [];
  const groupsSeen = new Set<string>();
  for (const row of sorted) {
    if (row.groupId) {
      if (groupsSeen.has(row.groupId)) continue;
      groupsSeen.add(row.groupId);
      const rowsInGroup = sorted.filter((r) => r.groupId === row.groupId);
      entries.push({ kind: "group", groupId: row.groupId, rows: rowsInGroup });
    } else {
      entries.push({ kind: "single", row });
    }
  }
  return entries;
}

function entryKey(e: DisplayEntry): string {
  return e.kind === "single" ? e.row.id : e.groupId;
}

function entryContainsId(e: DisplayEntry, id: string | null): boolean {
  if (!id) return false;
  if (e.kind === "single") return e.row.id === id;
  return e.rows.some((r) => r.id === id);
}

type Tab = "marks" | "review" | "revise";

function NextStep({ command }: { command: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const onCopy = (): void => {
    void navigator.clipboard?.writeText(command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="review-pane__next">
      <p className="review-pane__next-label">Next: in your paper folder, run</p>
      <button
        type="button"
        className="review-pane__next-cmd"
        data-copied={copied ? "true" : "false"}
        onClick={onCopy}
        title={copied ? "Copied" : "Copy to clipboard"}
      >
        <code>{command}</code>
        <span className="review-pane__next-hint" aria-hidden="true">
          {copied ? "Copied" : "Click to copy"}
        </span>
      </button>
    </div>
  );
}

export default function ReviewPane({
  annotations,
  selectedAnchor,
  draftCategory,
  draftNote,
  focusedAnnotationId,
  rubric,
  onSave,
  onDiscard,
  onDraftCategoryChange,
  onDraftNoteChange,
  onUpdateNote,
  onDelete,
  onDeleteGroup,
  onExportReview,
  onExportRevise,
  onExportMarkdown,
  onExportReviewMarkdown,
  onCopy,
  onCopyReview,
  onRubricChange,
  exportDisabled,
  statusMessage,
  statusTone,
}: Props): JSX.Element {
  const entries = useMemo(() => buildDisplayEntries(annotations), [annotations]);
  const itemsRef = useRef<HTMLOListElement | null>(null);
  const [tab, setTab] = useState<Tab>("marks");
  const [reviewExportedName, setReviewExportedName] = useState<string | null>(null);
  const [reviseExportedName, setReviseExportedName] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);

  const exportReview = async (): Promise<void> => {
    const name = await onExportReview();
    if (name) setReviewExportedName(name);
  };
  const exportRevise = async (): Promise<void> => {
    const name = await onExportRevise();
    if (name) setReviseExportedName(name);
  };

  const pages = selectedAnchor
    ? Array.from(new Set(selectedAnchor.slices.map((s) => s.anchor.pageIndex + 1)))
    : [];
  const pagesLabel = pages.length > 0 ? `p. ${pages.join(", ")}` : "";

  useEffect(() => {
    if (tab !== "marks") return;
    if (!focusedAnnotationId) return;
    const root = itemsRef.current;
    if (!root) return;
    const target = root.querySelector<HTMLElement>(`[data-focused="true"]`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [focusedAnnotationId, tab]);

  useEffect(() => {
    if (focusedAnnotationId) setTab("marks");
  }, [focusedAnnotationId]);

  useEffect(() => {
    if (selectedAnchor) setTab("marks");
  }, [selectedAnchor]);

  useEffect(() => {
    if (draftCategory || !selectedAnchor) setSaveError(false);
  }, [draftCategory, selectedAnchor]);

  return (
    <aside className="review-pane" aria-label="Review pane">
      {selectedAnchor ? (
        <section className="review-pane__draft" aria-label="Draft mark">
          <header className="review-pane__draft-head">
            <span className="review-pane__draft-tag">{"DRAFT \u00b7 unsaved"}</span>
            {pagesLabel ? <span className="review-pane__draft-pages">{pagesLabel}</span> : null}
          </header>
          <p className="review-pane__draft-hint">
            Pick a category and save, or discard this selection.
          </p>
          <blockquote className="review-pane__quote">
            <span className="review-pane__context">{selectedAnchor.contextBefore}</span>
            <mark className="review-pane__quote-mark">{selectedAnchor.quote}</mark>
            <span className="review-pane__context">{selectedAnchor.contextAfter}</span>
          </blockquote>
          <CategoryPicker
            name="draft-category"
            value={draftCategory}
            onChange={onDraftCategoryChange}
            invalid={saveError}
            errorId="draft-category-error"
          />
          {saveError ? (
            <p className="review-pane__draft-error" id="draft-category-error" role="alert">
              Pick a category to save this mark.
            </p>
          ) : null}
          <NoteEditor
            value={draftNote}
            onChange={onDraftNoteChange}
            onCommit={onDraftNoteChange}
            placeholder="What needs attention?"
          />
          <div className="review-pane__draft-actions">
            <button
              type="button"
              className="review-pane__btn review-pane__btn--primary"
              onClick={() => {
                if (!selectedAnchor) return;
                if (!draftCategory) {
                  setSaveError(true);
                  return;
                }
                void onSave({
                  draft: selectedAnchor,
                  category: draftCategory,
                  note: draftNote.trim(),
                });
              }}
            >
              Save mark
            </button>
            <button
              type="button"
              className="review-pane__btn review-pane__btn--ghost"
              onClick={onDiscard}
            >
              Discard
            </button>
          </div>
        </section>
      ) : null}

      <div className="review-pane__tabs" role="tablist" aria-label="Review pane">
        <button
          type="button"
          role="tab"
          id="review-pane-tab-marks"
          aria-controls="review-pane-panel-marks"
          aria-selected={tab === "marks"}
          className="review-pane__tab"
          data-active={tab === "marks" ? "true" : "false"}
          onClick={() => setTab("marks")}
        >
          <span className="review-pane__tab-label">Marks</span>
          <span className="review-pane__tab-count">{annotations.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          id="review-pane-tab-review"
          aria-controls="review-pane-panel-review"
          aria-selected={tab === "review"}
          className="review-pane__tab"
          data-active={tab === "review" ? "true" : "false"}
          onClick={() => setTab("review")}
        >
          <span className="review-pane__tab-label">Review</span>
        </button>
        <button
          type="button"
          role="tab"
          id="review-pane-tab-revise"
          aria-controls="review-pane-panel-revise"
          aria-selected={tab === "revise"}
          className="review-pane__tab"
          data-active={tab === "revise" ? "true" : "false"}
          onClick={() => setTab("revise")}
        >
          <span className="review-pane__tab-label">Revise</span>
        </button>
      </div>

      {tab === "marks" ? (
        <section
          className="review-pane__list"
          aria-label="Annotations"
          role="tabpanel"
          id="review-pane-panel-marks"
          aria-labelledby="review-pane-tab-marks"
        >
          {entries.length === 0 ? (
            <div className="review-pane__empty">
              <p>Highlight a passage in the PDF. A form appears here to categorize it.</p>
              <p>
                Your marks line up in the margin next to the lines they reference. When you are
                done, switch to <em>Review</em> to draft a reviewer's write-up or <em>Revise</em> to
                hand the marks to a coding agent as source patches.
              </p>
            </div>
          ) : (
            <ol className="review-pane__items" ref={itemsRef}>
              {entries.map((entry) => (
                <AnnotationItem
                  key={entryKey(entry)}
                  entry={entry}
                  focused={entryContainsId(entry, focusedAnnotationId)}
                  onUpdateNote={onUpdateNote}
                  onDelete={onDelete}
                  onDeleteGroup={onDeleteGroup}
                />
              ))}
            </ol>
          )}
        </section>
      ) : tab === "review" ? (
        <section
          className="review-pane__tabpanel"
          aria-label="Review"
          role="tabpanel"
          id="review-pane-panel-review"
          aria-labelledby="review-pane-tab-review"
        >
          <RubricPanel rubric={rubric} onChange={onRubricChange} />
          <p className="review-pane__tabpanel-hint">
            Hand your marks to a coding agent and get back a journal-style write-up
            {rubric ? ", weighted against your attached rubric" : ""}. The agent does not edit any
            paper source — it only writes the review.
          </p>
          <fieldset className="review-pane__actions" aria-label="Review output">
            <div className="review-pane__actions-group">
              <button
                type="button"
                className="review-pane__actions-chip"
                onClick={() => void exportReview()}
                disabled={exportDisabled}
              >
                <span className="review-pane__actions-chip-label">JSON bundle</span>
                <span className="review-pane__actions-chip-hint">obelus-review.json</span>
              </button>
              {reviewExportedName ? (
                <NextStep command={`/write-review ~/Downloads/${reviewExportedName}`} />
              ) : null}
            </div>
            <button
              type="button"
              className="review-pane__actions-chip"
              onClick={onExportReviewMarkdown}
              disabled={exportDisabled}
            >
              <span className="review-pane__actions-chip-label">Markdown</span>
              <span className="review-pane__actions-chip-hint">obelus-review.md</span>
            </button>
            <button
              type="button"
              className="review-pane__actions-chip"
              onClick={onCopyReview}
              disabled={exportDisabled}
            >
              <span className="review-pane__actions-chip-label">Copy to clipboard</span>
              <span className="review-pane__actions-chip-hint">paste into any agent</span>
            </button>
          </fieldset>
          {statusMessage ? (
            <p className="review-pane__status" data-status={statusTone}>
              {statusMessage}
            </p>
          ) : null}
        </section>
      ) : (
        <section
          className="review-pane__tabpanel"
          aria-label="Revise"
          role="tabpanel"
          id="review-pane-panel-revise"
          aria-labelledby="review-pane-tab-revise"
        >
          <p className="review-pane__tabpanel-hint">
            Hand the paper folder to a coding agent and have it apply your marks as minimal-diff
            source edits. The bundle is format-agnostic — the plugin detects <code>.tex</code> /{" "}
            <code>.md</code> / <code>.typ</code> at run time.
          </p>
          <fieldset className="review-pane__actions" aria-label="Revise output">
            <div className="review-pane__actions-group">
              <button
                type="button"
                className="review-pane__actions-chip"
                onClick={() => void exportRevise()}
                disabled={exportDisabled}
              >
                <span className="review-pane__actions-chip-label">JSON bundle</span>
                <span className="review-pane__actions-chip-hint">obelus-revise.json</span>
              </button>
              {reviseExportedName ? (
                <NextStep command={`/apply-revision ~/Downloads/${reviseExportedName}`} />
              ) : null}
            </div>
            <button
              type="button"
              className="review-pane__actions-chip"
              onClick={onExportMarkdown}
              disabled={exportDisabled}
            >
              <span className="review-pane__actions-chip-label">Markdown</span>
              <span className="review-pane__actions-chip-hint">obelus-revise.md</span>
            </button>
            <button
              type="button"
              className="review-pane__actions-chip"
              onClick={onCopy}
              disabled={exportDisabled}
            >
              <span className="review-pane__actions-chip-label">Copy to clipboard</span>
              <span className="review-pane__actions-chip-hint">paste into any agent</span>
            </button>
          </fieldset>
          {statusMessage ? (
            <p className="review-pane__status" data-status={statusTone}>
              {statusMessage}
            </p>
          ) : null}
        </section>
      )}
    </aside>
  );
}
