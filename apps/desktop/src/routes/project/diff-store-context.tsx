import type { Repository, ReviewSessionRow } from "@obelus/repo";
import type { JSX } from "react";
import { createContext, type ReactNode, useContext, useEffect, useMemo } from "react";
import { createDiffStore, type DiffStore } from "../../lib/diff-store";
import { useJobsStore } from "../../lib/jobs-store";
import { useProject } from "./context";
import { usePaperId } from "./OpenPaper";

const DiffStoreContext = createContext<DiffStore | null>(null);

export function DiffStoreProvider({ children }: { children: ReactNode }): JSX.Element {
  const { repo } = useProject();
  const activePaperId = usePaperId();
  const store = useMemo(() => createDiffStore(repo.diffHunks, repo.reviewSessions), [repo]);

  // Source of truth is the DB: query the latest review session that is
  // neither discarded nor already applied for the active paper, and load its
  // hunks. Applied sessions have landed as drafts — they belong to the Drafts
  // tab, not the Diff tab. Subscribing to the jobs store is still load-bearing
  // for the in-flight → done transition (we re-query then), but a fresh app
  // refresh now finds the previous review without any job records present.
  useEffect(() => {
    let cancelled = false;

    const run = async (): Promise<void> => {
      const current = store.getState().sessionId;
      if (!activePaperId) {
        if (current !== null) store.getState().clear();
        return;
      }
      const latest = await findLatestVisibleReviewForPaper(repo, activePaperId);
      if (cancelled) return;
      if (!latest) {
        if (current !== null) store.getState().clear();
        return;
      }
      if (current !== latest.id) {
        await store.getState().load(latest.id);
        if (cancelled) return;
      }
    };

    void run();
    const unsubscribe = useJobsStore.subscribe(() => {
      void run();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [repo, store, activePaperId]);

  return <DiffStoreContext.Provider value={store}>{children}</DiffStoreContext.Provider>;
}

export function useDiffStore(): DiffStore {
  const store = useContext(DiffStoreContext);
  if (!store) throw new Error("useDiffStore requires DiffStoreProvider");
  return store;
}

// "Visible" = anything that produced hunks the user might still want to
// actively review. We exclude `discarded` (explicit user dismissal) and
// pre-ingest states so the UI doesn't flash an empty diff while plan-fix is
// still writing, and we exclude sessions that have already been applied
// (`appliedAt !== null`) — those have landed as drafts and belong to the
// Drafts tab. Without this second filter, the post-apply jobs-store tick
// re-loads the just-applied session and the Diff tab reappears with the
// hunks and the "keep these changes" button, as if nothing had been applied.
async function findLatestVisibleReviewForPaper(
  repo: Repository,
  paperId: string,
): Promise<ReviewSessionRow | undefined> {
  const rows = await repo.reviewSessions.listForPaper(paperId);
  return rows.find(
    (r) => (r.status === "completed" || r.status === "failed") && r.appliedAt === null,
  );
}
