import type { PaperRow, RevisionRow } from "@obelus/repo";
import { useEffect, useRef } from "react";
import { fsStat } from "../../ipc/commands";
import { useBuffersStore } from "./buffers-store-context";
import { useProject } from "./context";
import { useOpenPaper } from "./OpenPaper";
import { useReviewStore } from "./store-context";
import { verifyMarksAgainstText } from "./verify-source-marks";

// Polls the currently-open MD paper whenever the window regains focus or
// the user switches tabs. Compares the on-disk SHA256 to the last-observed
// hash; on mismatch, refreshes the buffer via `buffers.refreshFromDisk`
// and re-verifies every mark against the new bytes.
//
// No `notify` crate, no Rust-side watcher. The focus/visibility events are
// cheap; a single `fs_stat` per refocus for the open file is trivial. This
// is the v1 pattern documented in the plan — HTML (Phase 2) will plug in
// the same way once it carries a stored content hash.
export function useExternalChangeWatcher(): void {
  const { rootId } = useProject();
  const openPaper = useOpenPaper();
  const buffers = useBuffersStore();
  const reviewStore = useReviewStore();

  // Snapshot what the current surface wants to watch. Only MD papers with a
  // materialized PaperRow + RevisionRow get watched; pre-first-mark writer
  // files have no stored hash to compare against.
  const watchTargetRef = useRef<{
    paper: PaperRow;
    revision: RevisionRow;
    relPath: string;
  } | null>(null);
  watchTargetRef.current =
    openPaper.kind === "ready-md" && openPaper.paper !== null && openPaper.revision !== null
      ? { paper: openPaper.paper, revision: openPaper.revision, relPath: openPaper.path }
      : null;

  // Last SHA256 we've observed on disk for the currently-watched file.
  // Seeded from the revision's stored hash on first check. Reset whenever
  // the watched file identity (paperId + relPath) changes.
  const lastShaRef = useRef<{ relPath: string; paperId: string; sha: string } | null>(null);

  useEffect(() => {
    const checkNow = async (): Promise<void> => {
      const target = watchTargetRef.current;
      if (target === null) return;
      const { paper, revision, relPath } = target;
      const seed =
        lastShaRef.current !== null &&
        lastShaRef.current.paperId === paper.id &&
        lastShaRef.current.relPath === relPath
          ? lastShaRef.current.sha
          : revision.pdfSha256;
      try {
        const stat = await fsStat(rootId, relPath);
        if (stat.sha256 === seed) {
          lastShaRef.current = { relPath, paperId: paper.id, sha: stat.sha256 };
          return;
        }
        const dirty = buffers.getState().isDirty(relPath);
        if (dirty) {
          console.warn("[external-change]", {
            paperId: paper.id,
            relPath,
            oldSha: seed,
            newSha: stat.sha256,
            outcome: "conflict-buffer-dirty",
          });
          buffers.getState().setPendingExternalReload({
            relPath,
            newSha256: stat.sha256,
          });
          // Don't advance lastShaRef — the next check will see the same
          // mismatch, so once the user resolves the conflict (save/discard)
          // the reload path can fire.
          return;
        }
        await buffers.getState().refreshFromDisk([relPath]);
        const entry = buffers.getState().buffers.get(relPath);
        const text = entry?.diskText ?? null;
        if (text !== null) {
          const annotations = reviewStore.getState().annotations;
          const patches = verifyMarksAgainstText(relPath, text, annotations);
          await reviewStore.getState().updateStaleness(patches);
          console.info("[external-change]", {
            paperId: paper.id,
            relPath,
            oldSha: seed,
            newSha: stat.sha256,
            markCount: annotations.length,
            transitions: patches.map((p) => ({ id: p.id, staleness: p.staleness })),
            outcome: "reloaded",
          });
        }
        lastShaRef.current = { relPath, paperId: paper.id, sha: stat.sha256 };
      } catch (err) {
        console.warn("[external-change]", {
          relPath,
          outcome: "stat-failed",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    };

    const onFocus = (): void => {
      void checkNow();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === "visible") void checkNow();
    };

    void checkNow();

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [rootId, buffers, reviewStore]);
}
