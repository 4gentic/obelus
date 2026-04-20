import type { DiffHunkRow } from "@obelus/repo";
import type { JSX } from "react";
import { useEffect, useMemo, useState } from "react";
import { useKeyNav } from "../../lib/use-key-nav";
import { useDiffStore } from "./diff-store-context";
import HunkBlock from "./HunkBlock";
import { useReviewRunner } from "./review-runner-context";

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

  useEffect(() => {
    if (activeFile === null && files.length > 0) {
      const first = files[0];
      if (first !== undefined) setActiveFile(first);
    }
  }, [activeFile, files]);

  const focusedHunk = hunks[focusedIndex];
  const visibleHunks = useMemo(() => {
    if (activeFile === null) return hunks;
    return hunks.filter((h) => (h.file === "" ? "(unresolved)" : h.file) === activeFile);
  }, [hunks, activeFile]);

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
    const clock = new Date(startedAt).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
    const markLabel = marks === 1 ? "mark" : "marks";
    const fileLabel = files === 1 ? "file" : "files";
    return (
      <div className="diff-review__empty">
        <p>Claude is reading your marks.</p>
        <p>
          {marks} {markLabel} · {files} {fileLabel} · started {clock}.
        </p>
        <p className="diff-review__empty-ellipsis">· · · first hunk in a moment.</p>
      </div>
    );
  }

  if (sessionId === null || hunks.length === 0) {
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
              >
                {file}
                <span className="diff-review__tab-count">
                  {accepted}/{bucket.length}
                </span>
              </button>
            );
          })}
        </nav>
        <div className="diff-review__counter">
          <span>
            {acceptedTotal}/{hunks.length} accepted
          </span>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!applicable}
            onClick={() => void props.onApply()}
          >
            apply · .
          </button>
        </div>
      </header>

      {applyStatus.kind === "applied" && (
        <p className="diff-review__banner diff-review__banner--ok">
          Written to {applyStatus.filesWritten} file{applyStatus.filesWritten === 1 ? "" : "s"}.
          Nothing was sent anywhere.
        </p>
      )}
      {applyStatus.kind === "error" && (
        <p className="diff-review__banner diff-review__banner--err">{applyStatus.message}</p>
      )}
      {applyStatus.kind === "applying" && <p className="diff-review__banner">Applying…</p>}

      <section className="diff-review__list">
        {visibleHunks.map((h) => {
          const global = hunks.indexOf(h);
          const key = h.file === "" ? "(unresolved)" : h.file;
          const bucket = grouped.get(key) ?? [];
          const indexInFile = bucket.indexOf(h);
          return (
            <HunkBlock
              key={h.id}
              hunk={h}
              indexInFile={indexInFile}
              totalInFile={bucket.length}
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
