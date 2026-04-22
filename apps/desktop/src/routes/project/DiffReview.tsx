import type { DiffHunkRow } from "@obelus/repo";
import type { JSX } from "react";
import { useEffect, useMemo, useState } from "react";
import { fsReadFile } from "../../ipc/commands";
import { useKeyNav } from "../../lib/use-key-nav";
import ClaudeChip from "./ClaudeChip";
import { useProject } from "./context";
import { useDiffStore } from "./diff-store-context";
import HunkBlock from "./HunkBlock";
import { useReviewProgress, useReviewRunner } from "./review-runner-context";

interface Props {
  onApply: () => void | Promise<void>;
  onRepass: () => void | Promise<void>;
}

function groupByFile(hunks: ReadonlyArray<DiffHunkRow>): Map<string, DiffHunkRow[]> {
  const map = new Map<string, DiffHunkRow[]>();
  for (const h of hunks) {
    const key = h.file === "" ? "(unresolved)" : h.file;
    const bucket = map.get(key) ?? [];
    bucket.push(h);
    map.set(key, bucket);
  }
  return map;
}

export default function DiffReview(props: Props): JSX.Element {
  const { rootId } = useProject();
  const store = useDiffStore();
  const runner = useReviewRunner();
  const sessionId = store((s) => s.sessionId);
  const hunks = store((s) => s.hunks);
  const focusedIndex = store((s) => s.focusedIndex);
  const editingId = store((s) => s.editingId);
  const editingText = store((s) => s.editingText);
  const noteId = store((s) => s.noteId);
  const noteText = store((s) => s.noteText);
  const counts = store((s) => s.counts);
  const applyStatus = store((s) => s.applyStatus);

  const [activeFile, setActiveFile] = useState<string | null>(null);

  const grouped = useMemo(() => groupByFile(hunks), [hunks]);
  const files = useMemo(() => [...grouped.keys()], [grouped]);

  const focusedHunk = hunks[focusedIndex];
  const visibleHunks = useMemo(() => {
    if (activeFile === null) return hunks;
    return hunks.filter((h) => (h.file === "" ? "(unresolved)" : h.file) === activeFile);
  }, [hunks, activeFile]);

  const [sourceByFile, setSourceByFile] = useState<ReadonlyMap<string, string>>(
    () => new Map<string, string>(),
  );
  useEffect(() => {
    const wanted = new Set<string>();
    for (const h of hunks) {
      if (h.file !== "") wanted.add(h.file);
    }
    const missing = [...wanted].filter((f) => !sourceByFile.has(f));
    if (missing.length === 0) return;
    let cancelled = false;
    void (async () => {
      const loaded: Array<[string, string]> = [];
      for (const file of missing) {
        try {
          const buf = await fsReadFile(rootId, file);
          const text = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(buf));
          loaded.push([file, text]);
        } catch {
          // Source unreadable (moved, deleted, or binary); skip — HunkBlock
          // falls back to the minimal patch with no context.
        }
      }
      if (cancelled || loaded.length === 0) return;
      setSourceByFile((prev) => {
        const next = new Map(prev);
        for (const [f, t] of loaded) next.set(f, t);
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [hunks, rootId, sourceByFile]);

  const modeless = editingId === null && noteId === null;

  useKeyNav(
    {
      j: () => store.getState().next(),
      k: () => store.getState().prev(),
      a: () => void store.getState().accept(),
      r: () => void store.getState().reject(),
      Backspace: () => void store.getState().reject(),
      e: () => {
        const f = store.getState().hunks[store.getState().focusedIndex];
        if (f) store.getState().startEdit(f.id);
      },
      n: () => {
        const f = store.getState().hunks[store.getState().focusedIndex];
        if (f) store.getState().startNote(f.id);
      },
      A: () => {
        const f = store.getState().hunks[store.getState().focusedIndex];
        if (f) void store.getState().acceptFile(f.file === "" ? "" : f.file);
      },
      ".": () => void props.onApply(),
      ",": () => void props.onRepass(),
      g: { g: () => store.getState().focusFirst() },
      G: () => store.getState().focusLast(),
    },
    { enabled: modeless && hunks.length > 0 },
  );

  if (
    hunks.length === 0 &&
    (runner.status.kind === "working" ||
      runner.status.kind === "running" ||
      runner.status.kind === "ingesting")
  ) {
    const { marks, files, startedAt } = runner.status.counts;
    return (
      <ReviewProgressPanel
        marks={marks}
        files={files}
        startedAt={startedAt}
        stage={runner.status.kind}
      />
    );
  }

  if (sessionId === null || hunks.length === 0) {
    if (applyStatus.kind === "applied") {
      return (
        <div className="diff-review diff-review--applied">
          <p className="diff-review__banner diff-review__banner--ok">
            {applyStatus.draftOrdinal !== undefined
              ? `Draft ${applyStatus.draftOrdinal} is saved. `
              : ""}
            {applyStatus.hunksApplied} change{applyStatus.hunksApplied === 1 ? "" : "s"} to{" "}
            {applyStatus.filesWritten} file{applyStatus.filesWritten === 1 ? "" : "s"}.
          </p>
          <p className="review-column__hint">
            The marks that shipped are stored with this draft. Start a new review when you're ready.
          </p>
        </div>
      );
    }
    return <p className="review-column__hint">Plan loaded but no hunks were produced.</p>;
  }

  const acceptedTotal = counts.accepted + counts.modified;
  const runnerBusy =
    runner.status.kind === "working" ||
    runner.status.kind === "running" ||
    runner.status.kind === "ingesting";
  const applicable =
    acceptedTotal > 0 &&
    applyStatus.kind !== "applying" &&
    applyStatus.kind !== "applied" &&
    !runnerBusy;

  return (
    <div className="diff-review">
      <header className="diff-review__head">
        <nav className="diff-review__tabs">
          <span className="diff-review__tabs-label">files</span>
          <button
            type="button"
            className={`diff-review__tab${activeFile === null ? " diff-review__tab--on" : ""}`}
            onClick={() => setActiveFile(null)}
            title="Show hunks across every file"
          >
            <span className="diff-review__tab-label">all</span>
            <span className="diff-review__tab-count">
              {acceptedTotal}/{hunks.length}
            </span>
          </button>
          {files.map((file) => {
            const bucket = grouped.get(file) ?? [];
            const accepted = bucket.filter(
              (h) => h.state === "accepted" || h.state === "modified",
            ).length;
            return (
              <button
                key={file}
                type="button"
                className={`diff-review__tab${activeFile === file ? " diff-review__tab--on" : ""}`}
                onClick={() => setActiveFile(file)}
                title={file}
              >
                <span className="diff-review__tab-label">{file}</span>
                <span className="diff-review__tab-count">
                  {accepted}/{bucket.length}
                </span>
              </button>
            );
          })}
        </nav>
        <div className="diff-review__counter">
          <ClaudeChip />
          <span>
            {acceptedTotal}/{hunks.length} accepted
          </span>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!applicable}
            onClick={() => void props.onApply()}
          >
            keep these changes · .
          </button>
        </div>
      </header>

      {applyStatus.kind === "applied" && (
        <p className="diff-review__banner diff-review__banner--ok">
          {applyStatus.draftOrdinal !== undefined
            ? `Draft ${applyStatus.draftOrdinal} is saved. `
            : ""}
          {applyStatus.hunksApplied} change{applyStatus.hunksApplied === 1 ? "" : "s"} to{" "}
          {applyStatus.filesWritten} file{applyStatus.filesWritten === 1 ? "" : "s"}. Nothing was
          sent anywhere.
        </p>
      )}
      {applyStatus.kind === "error" && (
        <p className="diff-review__banner diff-review__banner--err">{applyStatus.message}</p>
      )}
      {applyStatus.kind === "applying" && <p className="diff-review__banner">Applying…</p>}

      <section className="diff-review__list">
        {visibleHunks.map((h, vi) => {
          const global = hunks.indexOf(h);
          const key = h.file === "" ? "(unresolved)" : h.file;
          const bucket = grouped.get(key) ?? [];
          const indexInFile = bucket.indexOf(h);
          const prev = vi === 0 ? null : visibleHunks[vi - 1];
          const prevKey =
            prev === undefined || prev === null
              ? null
              : prev.file === ""
                ? "(unresolved)"
                : prev.file;
          const isFileBoundary = prevKey !== key;
          const source = h.file === "" ? null : (sourceByFile.get(h.file) ?? null);
          return (
            <div key={h.id} className="diff-review__group">
              {isFileBoundary && (
                <h3 className="diff-review__file-header" title={key}>
                  <span className="diff-review__file-header-path">{key}</span>
                  <span className="diff-review__file-header-count">
                    {bucket.length} hunk{bucket.length === 1 ? "" : "s"}
                  </span>
                </h3>
              )}
              <HunkBlock
                hunk={h}
                indexInFile={indexInFile}
                totalInFile={bucket.length}
                sourceText={source}
                focused={focusedHunk?.id === h.id}
                editing={editingId === h.id}
                editingText={editingText}
                noting={noteId === h.id}
                noteText={noteText}
                onFocus={() => store.getState().focus(global)}
                onAccept={() => void store.getState().accept(h.id)}
                onReject={() => void store.getState().reject(h.id)}
                onStartEdit={() => store.getState().startEdit(h.id)}
                onEditChange={(t) => store.getState().setEditingText(t)}
                onCommitEdit={() => void store.getState().commitEdit()}
                onCancelEdit={() => store.getState().cancelEdit()}
                onStartNote={() => store.getState().startNote(h.id)}
                onNoteChange={(t) => store.getState().setNoteText(t)}
                onCommitNote={() => void store.getState().commitNote()}
                onCancelNote={() => store.getState().cancelNote()}
              />
            </div>
          );
        })}
      </section>

      <footer className="diff-review__foot">
        <span>j/k nav</span>
        <span>a/r accept/reject</span>
        <span>e edit</span>
        <span>n note</span>
        <span>⇧a accept file</span>
        <span>gg / G top/bottom</span>
        <span>. apply</span>
        <span>, re-review</span>
      </footer>
    </div>
  );
}

const FILLER_LINES: ReadonlyArray<string> = [
  "the review is a careful reading.",
  "every page is turned.",
  "the manuscript is read like a letter.",
  "weighing the argument.",
  "consulting the marginalia.",
  "cross-checking the citations.",
];

interface ReviewProgressPanelProps {
  marks: number;
  files: number;
  startedAt: number;
  stage: "working" | "running" | "ingesting";
}

function ReviewProgressPanel({
  marks,
  files,
  startedAt,
  stage,
}: ReviewProgressPanelProps): JSX.Element {
  const progress = useReviewProgress();
  const phase = progress((s) => s.phase);
  const toolEvents = progress((s) => s.toolEvents);
  const assistantChars = progress((s) => s.assistantChars);
  const lastThinkingAt = progress((s) => s.lastThinkingAt);

  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const [fillerIndex, setFillerIndex] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      setFillerIndex((i) => (i + 1) % FILLER_LINES.length);
    }, 8000);
    return () => window.clearInterval(id);
  }, []);

  const clock = new Date(startedAt).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  const markLabel = marks === 1 ? "mark" : "marks";
  const fileLabel = files === 1 ? "file" : "files";
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  const elapsedLabel =
    elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;

  const phaseLine =
    phase ||
    (stage === "ingesting"
      ? "Reading the plan."
      : stage === "working"
        ? "Getting ready."
        : "Waiting for Claude.");

  const thinking = lastThinkingAt !== null && now - lastThinkingAt < 3000;
  const filler = FILLER_LINES[fillerIndex] ?? FILLER_LINES[0] ?? "";

  return (
    <div className="review-progress">
      <div className="review-progress__head">
        <ClaudeChip />
      </div>
      <p className="review-progress__phase">
        {phaseLine}
        {thinking ? <span className="review-progress__pulse" aria-hidden /> : null}
      </p>
      <p className="review-progress__counters">
        {marks} {markLabel} · {files} {fileLabel} · {toolEvents} tool{toolEvents === 1 ? "" : "s"} ·{" "}
        {assistantChars.toLocaleString()} chars · {elapsedLabel} · started {clock}
      </p>
      <p className="review-progress__filler">…{filler}</p>
    </div>
  );
}
