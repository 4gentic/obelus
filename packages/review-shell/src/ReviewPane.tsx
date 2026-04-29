import type { AnnotationRow, PaperRubric } from "@obelus/repo";
import type { DraftInput } from "@obelus/review-store";
import { useEffect, useMemo, useRef, useState } from "react";
import CategoryPicker from "./CategoryPicker";
import CategorySelect from "./CategorySelect";
import NoteEditor from "./NoteEditor";
import RubricPanel from "./RubricPanel";
import "./ReviewPane.css";

import type { JSX } from "react";

export type ReviewPaneExports = {
  onExportReview: () => Promise<string | null>;
  onExportRevise: () => Promise<string | null>;
  onExportReviewMarkdown: () => void;
  onExportMarkdown: () => void;
  onCopy: () => void;
  onCopyReview: () => void;
};

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
  onUpdateCategory: (id: string, category: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onDeleteGroup: (groupId: string) => Promise<void>;
  onJumpToMark: (id: string) => void;
  onRubricChange: (rubric: PaperRubric | null) => Promise<void>;
  exports: ReviewPaneExports;
  exportDisabled: boolean;
  statusMessage: string | null;
  statusTone: "idle" | "working" | "done" | "error";
};

type DisplayEntry =
  | { kind: "single"; row: AnnotationRow }
  | { kind: "group"; groupId: string; rows: readonly [AnnotationRow, ...AnnotationRow[]] };

// Row-agnostic "where in the paper" label. The pane switches on the anchor's
// discriminant: PDF anchors render as "p. N", source anchors as a line range,
// HTML anchors fall back to the source-hint line range when present (paired)
// or a char offset range (hand-authored).
function locationLabel(row: AnnotationRow): string {
  if (row.anchor.kind === "pdf") return `p. ${row.anchor.page}`;
  if (row.anchor.kind === "html") {
    if (row.anchor.sourceHint) {
      const { lineStart, lineEnd } = row.anchor.sourceHint;
      return lineStart === lineEnd ? `L${lineStart}` : `L${lineStart}–${lineEnd}`;
    }
    const { charOffsetStart, charOffsetEnd } = row.anchor;
    return `c${charOffsetStart}–${charOffsetEnd}`;
  }
  if (row.anchor.kind === "html-element") {
    if (row.anchor.sourceHint) {
      const { lineStart, lineEnd } = row.anchor.sourceHint;
      return lineStart === lineEnd ? `L${lineStart}` : `L${lineStart}–${lineEnd}`;
    }
    return row.anchor.file;
  }
  const { lineStart, lineEnd } = row.anchor;
  return lineStart === lineEnd ? `L${lineStart}` : `L${lineStart}–${lineEnd}`;
}

function entryLocationLabel(entry: DisplayEntry): string {
  if (entry.kind === "single") return locationLabel(entry.row);
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const r of entry.rows) {
    const l = locationLabel(r);
    if (l !== "" && !seen.has(l)) {
      seen.add(l);
      parts.push(l);
    }
  }
  return parts.join(", ");
}

// Mirrors apps/desktop/src/routes/project/ReviewList.tsx's INTERACTIVE_SELECTOR.
// `button` is a catch-all that covers Remove, the next-step copy button, and
// any future button without enumeration.
const INTERACTIVE_SELECTOR = ".cat-select__trigger, .cat-select__pop, textarea, button";

type AnnotationItemProps = {
  entry: DisplayEntry;
  focused: boolean;
  onUpdateNote: (id: string, note: string) => Promise<void>;
  onUpdateCategory: (id: string, category: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onDeleteGroup: (groupId: string) => Promise<void>;
  onJumpToMark: (id: string) => void;
};

function AnnotationItem({
  entry,
  focused,
  onUpdateNote,
  onUpdateCategory,
  onDelete,
  onDeleteGroup,
  onJumpToMark,
}: AnnotationItemProps): JSX.Element {
  const first = entry.kind === "single" ? entry.row : entry.rows[0];
  const [local, setLocal] = useState(first.note);
  const category = first.category;
  const locLabel = entryLocationLabel(entry);
  const quoteNodes =
    entry.kind === "single" ? (
      <blockquote className="review-pane__item-quote">{entry.row.quote}</blockquote>
    ) : (
      <div className="review-pane__item-quotes">
        {entry.rows.map((r) => (
          <blockquote key={r.id} className="review-pane__item-quote">
            <span className="review-pane__item-quote-page">{locationLabel(r)}</span>
            {r.quote}
          </blockquote>
        ))}
      </div>
    );

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard-accessible through pane controls and doc highlight clicks; onClick is a mouse-only shortcut to scroll the document to the source line.
    <li
      className="review-pane__item"
      data-category={category}
      data-focused={focused ? "true" : "false"}
      data-kind={entry.kind}
      onClick={(ev) => {
        if ((ev.target as HTMLElement).closest(INTERACTIVE_SELECTOR)) return;
        onJumpToMark(first.id);
      }}
    >
      <header className="review-pane__item-head">
        <div className="review-pane__item-head-left">
          <span className="review-pane__item-page">{locLabel}</span>
          <CategorySelect
            value={category}
            onChange={(c) => void onUpdateCategory(first.id, c)}
            ariaLabel={`Change category for mark at ${locLabel}`}
          />
        </div>
        {entry.kind === "group" ? (
          <span className="review-pane__item-link" title="Linked across pages">
            {"⇄"}
          </span>
        ) : null}
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

// Sorts annotations in reading order across all anchor flavours. PDF rows
// compare by page then text-item start; source rows compare by file then
// line/column; html rows compare by file then char offset (or by source-hint
// line/column when present, so paired-source HTML interleaves with native
// source rows). Cross-flavour comparisons fall back to createdAt — not
// expected (a paper is one format) but keeps the sort total.
function rowSortKey(row: AnnotationRow): [number, string, number, number] {
  if (row.anchor.kind === "pdf") {
    const start0 = row.anchor.textItemRange.start[0];
    const start1 = row.anchor.textItemRange.start[1];
    return [row.anchor.page, "", start0, start1];
  }
  if (row.anchor.kind === "html") {
    if (row.anchor.sourceHint) {
      const { file, lineStart, colStart } = row.anchor.sourceHint;
      return [0, file, lineStart, colStart];
    }
    return [0, row.anchor.file, row.anchor.charOffsetStart, row.anchor.charOffsetEnd];
  }
  if (row.anchor.kind === "html-element") {
    if (row.anchor.sourceHint) {
      const { file, lineStart, colStart } = row.anchor.sourceHint;
      return [0, file, lineStart, colStart];
    }
    return [0, row.anchor.file, 0, 0];
  }
  const { file, lineStart, colStart } = row.anchor;
  return [0, file, lineStart, colStart];
}

function compareRows(a: AnnotationRow, b: AnnotationRow): number {
  const ka = rowSortKey(a);
  const kb = rowSortKey(b);
  if (ka[0] !== kb[0]) return ka[0] - kb[0];
  if (ka[1] !== kb[1]) return ka[1] < kb[1] ? -1 : 1;
  if (ka[2] !== kb[2]) return ka[2] - kb[2];
  return ka[3] - kb[3];
}

function buildDisplayEntries(rows: ReadonlyArray<AnnotationRow>): DisplayEntry[] {
  const sorted = [...rows].sort(compareRows);
  const entries: DisplayEntry[] = [];
  const groupsSeen = new Set<string>();
  for (const row of sorted) {
    if (row.groupId) {
      if (groupsSeen.has(row.groupId)) continue;
      groupsSeen.add(row.groupId);
      const rowsInGroup: readonly [AnnotationRow, ...AnnotationRow[]] = [
        row,
        ...sorted.filter((r) => r.groupId === row.groupId && r.id !== row.id),
      ];
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

function draftLocationLabel(draft: DraftInput): string {
  const labels = new Set<string>();
  for (const slice of draft.slices) {
    if (slice.kind === "source") {
      const { lineStart, lineEnd } = slice.anchor;
      labels.add(lineStart === lineEnd ? `L${lineStart}` : `L${lineStart}–${lineEnd}`);
    } else if (slice.kind === "html" || slice.kind === "html-element") {
      labels.add(slice.anchor.file);
    } else {
      labels.add(`p. ${slice.anchor.pageIndex + 1}`);
    }
  }
  return Array.from(labels).join(", ");
}

// Stable per-draft identity so React remounts DraftSection when the user
// switches selections, discarding `saveError` naturally.
function draftSectionKey(draft: DraftInput): string {
  const first = draft.slices[0];
  if (!first) return draft.quote;
  if (first.kind === "source") {
    const a = first.anchor;
    return `s:${a.file}:${a.lineStart}:${a.colStart}:${a.lineEnd}:${a.colEnd}`;
  }
  if (first.kind === "html") {
    const a = first.anchor;
    return `h:${a.file}:${a.charOffsetStart}:${a.charOffsetEnd}:${draft.quote}`;
  }
  if (first.kind === "html-element") {
    const a = first.anchor;
    return `he:${a.file}:${a.xpath}:${draft.quote}`;
  }
  return `p:${first.anchor.pageIndex}:${draft.quote}`;
}

interface DraftSectionProps {
  draft: DraftInput;
  draftCategory: string | null;
  draftNote: string;
  onSave: Props["onSave"];
  onDiscard: () => void;
  onDraftCategoryChange: (category: string | null) => void;
  onDraftNoteChange: (note: string) => void;
}

function DraftSection({
  draft,
  draftCategory,
  draftNote,
  onSave,
  onDiscard,
  onDraftCategoryChange,
  onDraftNoteChange,
}: DraftSectionProps): JSX.Element {
  const [saveError, setSaveError] = useState(false);
  const locLabel = draftLocationLabel(draft);
  const handleCategoryChange = (c: string | null): void => {
    onDraftCategoryChange(c);
    if (c !== null) setSaveError(false);
  };
  return (
    <section className="review-pane__draft" aria-label="Draft mark">
      <header className="review-pane__draft-head">
        <span className="review-pane__draft-tag">{"DRAFT · unsaved"}</span>
        {locLabel ? <span className="review-pane__draft-pages">{locLabel}</span> : null}
      </header>
      <p className="review-pane__draft-hint">
        Pick a category and save, or discard this selection.
      </p>
      <blockquote className="review-pane__quote">
        <span className="review-pane__context">{draft.contextBefore}</span>
        <mark className="review-pane__quote-mark">{draft.quote}</mark>
        <span className="review-pane__context">{draft.contextAfter}</span>
      </blockquote>
      <CategoryPicker
        name="draft-category"
        value={draftCategory}
        onChange={handleCategoryChange}
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
            if (!draftCategory) {
              setSaveError(true);
              return;
            }
            void onSave({ draft, category: draftCategory, note: draftNote.trim() });
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
  onUpdateCategory,
  onDelete,
  onDeleteGroup,
  onJumpToMark,
  onRubricChange,
  exports,
  exportDisabled,
  statusMessage,
  statusTone,
}: Props): JSX.Element {
  const entries = useMemo(() => buildDisplayEntries(annotations), [annotations]);
  const itemsRef = useRef<HTMLOListElement | null>(null);
  const [tab, setTab] = useState<Tab>("marks");
  const [reviewExportedName, setReviewExportedName] = useState<string | null>(null);
  const [reviseExportedName, setReviseExportedName] = useState<string | null>(null);

  const exportReview = async (): Promise<void> => {
    const name = await exports.onExportReview();
    if (name) setReviewExportedName(name);
  };
  const exportRevise = async (): Promise<void> => {
    const name = await exports.onExportRevise();
    if (name) setReviseExportedName(name);
  };

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
    if (focusedAnnotationId || selectedAnchor) setTab("marks");
  }, [focusedAnnotationId, selectedAnchor]);

  return (
    <aside className="review-pane" aria-label="Review pane">
      {selectedAnchor ? (
        <DraftSection
          key={draftSectionKey(selectedAnchor)}
          draft={selectedAnchor}
          draftCategory={draftCategory}
          draftNote={draftNote}
          onSave={onSave}
          onDiscard={onDiscard}
          onDraftCategoryChange={onDraftCategoryChange}
          onDraftNoteChange={onDraftNoteChange}
        />
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
              <p>Highlight a passage in the paper. A form appears here to categorize it.</p>
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
                  onUpdateCategory={onUpdateCategory}
                  onDelete={onDelete}
                  onDeleteGroup={onDeleteGroup}
                  onJumpToMark={onJumpToMark}
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
              onClick={exports.onExportReviewMarkdown}
              disabled={exportDisabled}
            >
              <span className="review-pane__actions-chip-label">Markdown</span>
              <span className="review-pane__actions-chip-hint">obelus-review.md</span>
            </button>
            <button
              type="button"
              className="review-pane__actions-chip"
              onClick={exports.onCopyReview}
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
          <RubricPanel rubric={rubric} onChange={onRubricChange} />
          <p className="review-pane__tabpanel-hint">
            Hand the paper folder to a coding agent and have it apply your marks as minimal-diff
            source edits{rubric ? ", honoring the criteria your rubric names" : ""}. The bundle is
            format-agnostic — the plugin detects <code>.tex</code> / <code>.md</code> /{" "}
            <code>.typ</code> at run time.
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
              onClick={exports.onExportMarkdown}
              disabled={exportDisabled}
            >
              <span className="review-pane__actions-chip-label">Markdown</span>
              <span className="review-pane__actions-chip-hint">obelus-revise.md</span>
            </button>
            <button
              type="button"
              className="review-pane__actions-chip"
              onClick={exports.onCopy}
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
