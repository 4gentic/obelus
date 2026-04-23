import type { DiffHunkRow } from "@obelus/repo";
import type { JSX } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fsReadFile } from "../../ipc/commands";
import { type PhaseEntry, useJobsStore } from "../../lib/jobs-store";
import { paperHasSources } from "../../lib/paper-has-sources";
import { useKeyNav } from "../../lib/use-key-nav";
import ClaudeChip from "./ClaudeChip";
import { useProject } from "./context";
import { useDiffStore } from "./diff-store-context";
import HunkBlock from "./HunkBlock";
import { usePaperId } from "./OpenPaper";
import { useReviewProgress, useReviewRunner } from "./review-runner-context";
import type { ForkInfo } from "./use-diff-actions";
import { usePaperBuild } from "./use-paper-build";
import WidenToggle from "./WidenToggle";

interface Props {
  onApply: () => void | Promise<void>;
  onRepass: () => void | Promise<void>;
  forkInfo: ForkInfo | null;
  wide: boolean;
  onToggleWide: () => void;
}

const EMPTY_PHASE_HISTORY: readonly PhaseEntry[] = Object.freeze([]);

function fileKey(h: DiffHunkRow): string {
  return h.file === "" ? "(unresolved)" : h.file;
}

function groupByFile(hunks: ReadonlyArray<DiffHunkRow>): Map<string, DiffHunkRow[]> {
  const map = new Map<string, DiffHunkRow[]>();
  for (const h of hunks) {
    const key = fileKey(h);
    const bucket = map.get(key) ?? [];
    bucket.push(h);
    map.set(key, bucket);
  }
  return map;
}

export default function DiffReview(props: Props): JSX.Element {
  const { project, rootId, repo } = useProject();
  const store = useDiffStore();
  const runner = useReviewRunner();
  const activePaperId = usePaperId();
  const { build: paperBuild } = usePaperBuild(repo, activePaperId);
  const hasSources = paperHasSources(paperBuild);
  const phaseHistory = useJobsStore((s): ReadonlyArray<PhaseEntry> => {
    if (!activePaperId) return EMPTY_PHASE_HISTORY;
    let active: ReadonlyArray<PhaseEntry> | undefined;
    let latestStart = -1;
    for (const j of Object.values(s.jobs)) {
      if (j.kind !== "review") continue;
      if (j.projectId !== project.id || j.paperId !== activePaperId) continue;
      const live = j.status === "running" || j.status === "ingesting";
      if (!live) continue;
      if (j.startedAt > latestStart) {
        latestStart = j.startedAt;
        active = j.phaseHistory;
      }
    }
    return active ?? EMPTY_PHASE_HISTORY;
  });
  const sessionId = store((s) => s.sessionId);
  const hunks = store((s) => s.hunks);
  const focusedIndex = store((s) => s.focusedIndex);
  const editingId = store((s) => s.editingId);
  const editingText = store((s) => s.editingText);
  const noteId = store((s) => s.noteId);
  const noteText = store((s) => s.noteText);
  const counts = store((s) => s.counts);
  const applyStatus = store((s) => s.applyStatus);

  const grouped = useMemo(() => groupByFile(hunks), [hunks]);
  const files = useMemo(() => [...grouped.keys()], [grouped]);

  const [activeFile, setActiveFile] = useState<string | null>(() => files[0] ?? null);

  useEffect(() => {
    if (files.length === 0) {
      if (activeFile !== null) setActiveFile(null);
      return;
    }
    if (activeFile === null || !files.includes(activeFile)) {
      setActiveFile(files[0] ?? null);
    }
  }, [files, activeFile]);

  const focusedHunk = hunks[focusedIndex];
  const visibleHunks = useMemo(() => {
    if (activeFile === null) return [];
    return hunks.filter((h) => fileKey(h) === activeFile);
  }, [hunks, activeFile]);

  const pendingInActive = useMemo(() => {
    if (activeFile === null) return 0;
    const bucket = grouped.get(activeFile) ?? [];
    return bucket.reduce((n, h) => (h.state === "pending" ? n + 1 : n), 0);
  }, [grouped, activeFile]);

  const goToFile = useCallback(
    (file: string): void => {
      setActiveFile(file);
      const idx = hunks.findIndex((h) => fileKey(h) === file);
      if (idx >= 0) store.getState().focus(idx);
    },
    [hunks, store],
  );

  const stepFile = useCallback(
    (delta: 1 | -1): void => {
      if (files.length === 0 || activeFile === null) return;
      const idx = files.indexOf(activeFile);
      const nextIdx = (idx + delta + files.length) % files.length;
      const target = files[nextIdx];
      if (target !== undefined && target !== activeFile) goToFile(target);
    },
    [files, activeFile, goToFile],
  );

  const prevPendingInActiveRef = useRef(pendingInActive);
  useEffect(() => {
    const prev = prevPendingInActiveRef.current;
    prevPendingInActiveRef.current = pendingInActive;
    if (activeFile === null) return;
    if (prev <= 0 || pendingInActive !== 0) return;
    const activeIdx = files.indexOf(activeFile);
    const rotated = [...files.slice(activeIdx + 1), ...files.slice(0, activeIdx)];
    const next = rotated.find((f) => {
      const bucket = grouped.get(f) ?? [];
      return bucket.some((h) => h.state === "pending");
    });
    if (next !== undefined && next !== activeFile) goToFile(next);
  }, [pendingInActive, activeFile, files, grouped, goToFile]);

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

  const navInFile = useCallback(
    (delta: 1 | -1): void => {
      if (activeFile === null) return;
      const state = store.getState();
      const locals: number[] = [];
      state.hunks.forEach((h, i) => {
        if (fileKey(h) === activeFile) locals.push(i);
      });
      if (locals.length === 0) return;
      const curGlobal = state.focusedIndex;
      const curLocal = locals.indexOf(curGlobal);
      const nextLocal = curLocal < 0 ? 0 : (curLocal + delta + locals.length) % locals.length;
      const globalIdx = locals[nextLocal];
      if (globalIdx !== undefined) state.focus(globalIdx);
    },
    [activeFile, store],
  );

  const focusEdge = useCallback(
    (edge: "first" | "last"): void => {
      if (activeFile === null) return;
      const state = store.getState();
      const locals: number[] = [];
      state.hunks.forEach((h, i) => {
        if (fileKey(h) === activeFile) locals.push(i);
      });
      if (locals.length === 0) return;
      const pick = edge === "first" ? locals[0] : locals[locals.length - 1];
      if (pick !== undefined) state.focus(pick);
    },
    [activeFile, store],
  );

  useKeyNav(
    {
      j: () => navInFile(1),
      k: () => navInFile(-1),
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
      "[": () => stepFile(-1),
      "]": () => stepFile(1),
      ".": () => void props.onApply(),
      ",": () => void props.onRepass(),
      g: { g: () => focusEdge("first") },
      G: () => focusEdge("last"),
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
        phaseHistory={phaseHistory}
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
    const hint =
      (runner.status.kind === "done" || runner.status.kind === "error") && runner.status.message
        ? runner.status.message
        : !hasSources
          ? "This paper has no source files — the Diff tab records notes, not edits."
          : "Plan loaded but no hunks were produced.";
    return <p className="review-column__hint">{hint}</p>;
  }

  const acceptedTotal = counts.accepted + counts.modified;
  const runnerBusy =
    runner.status.kind === "working" ||
    runner.status.kind === "running" ||
    runner.status.kind === "ingesting";
  const applicable =
    counts.pending === 0 &&
    acceptedTotal > 0 &&
    applyStatus.kind !== "applying" &&
    applyStatus.kind !== "applied" &&
    !runnerBusy;

  return (
    <div className="diff-review">
      <header className="diff-review__head">
        <div className="diff-review__counter">
          <ClaudeChip />
          <span className="diff-review__counter-text">
            {counts.pending > 0 ? (
              <>
                <span className="diff-review__counter-pending">{counts.pending} pending</span>
                <span className="diff-review__counter-sep"> · </span>
                <span>
                  {acceptedTotal}/{hunks.length} kept
                </span>
              </>
            ) : (
              <>
                <span>
                  {acceptedTotal}/{hunks.length} kept
                </span>
                <span className="diff-review__counter-sep"> · </span>
                <span className="diff-review__counter-ready">ready</span>
              </>
            )}
          </span>
          <div className="diff-review__head-tools">
            <WidenToggle wide={props.wide} onToggle={props.onToggleWide} />
            <button
              type="button"
              className="btn btn--primary"
              disabled={!applicable}
              onClick={() => void props.onApply()}
              title={
                counts.pending > 0
                  ? `Handle the remaining ${counts.pending} hunk${counts.pending === 1 ? "" : "s"} first.`
                  : undefined
              }
            >
              keep these changes · .
            </button>
          </div>
        </div>
        <nav className="diff-review__files" aria-label="Files with pending review">
          {files.map((file) => {
            const bucket = grouped.get(file) ?? [];
            const handled = bucket.filter((h) => h.state !== "pending").length;
            const pending = bucket.length - handled;
            const isActive = activeFile === file;
            const isDone = pending === 0;
            return (
              <button
                key={file}
                type="button"
                className={[
                  "diff-review__file-row",
                  isActive ? "diff-review__file-row--on" : "",
                  isDone ? "diff-review__file-row--done" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => goToFile(file)}
                title={file}
                aria-current={isActive ? "true" : undefined}
              >
                <span className="diff-review__file-row-path">{file}</span>
                <span className="diff-review__file-row-count">
                  {handled}/{bucket.length}
                </span>
              </button>
            );
          })}
        </nav>
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
      {applyStatus.kind !== "applied" && props.forkInfo !== null && (
        <p className="diff-review__banner diff-review__banner--warn">
          You're viewing Draft {props.forkInfo.currentDraftOrdinal}. Applying forks the history —
          Draft{props.forkInfo.orphanedOrdinals.length === 1 ? "" : "s"}{" "}
          {props.forkInfo.orphanedOrdinals.join(", ")} stay as an alternate branch.
        </p>
      )}

      <section className="diff-review__list">
        {visibleHunks.map((h) => {
          const global = hunks.indexOf(h);
          const key = fileKey(h);
          const bucket = grouped.get(key) ?? [];
          const indexInFile = bucket.indexOf(h);
          const source = h.file === "" ? null : (sourceByFile.get(h.file) ?? null);
          return (
            <div key={h.id} className="diff-review__group">
              <HunkBlock
                hunk={h}
                indexInFile={indexInFile}
                totalInFile={bucket.length}
                sourceText={source}
                hasSources={hasSources}
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
        <span>[ / ] file</span>
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
  phaseHistory: ReadonlyArray<PhaseEntry>;
}

function ReviewProgressPanel({
  marks,
  files,
  startedAt,
  stage,
  phaseHistory,
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
  const logTail = phaseHistory.slice(-8);

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
      {logTail.length > 0 ? (
        <ol className="review-progress__log" aria-label="Phase timeline">
          {logTail.map((entry) => (
            <li key={`${entry.at}:${entry.phase}`}>
              <time className="review-progress__log-when">{formatHMS(entry.at)}</time>
              <span className="review-progress__log-what">{entry.phase}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function formatHMS(ms: number): string {
  const d = new Date(ms);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
