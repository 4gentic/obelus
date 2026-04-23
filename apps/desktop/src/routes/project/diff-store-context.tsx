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
  const store = useMemo(() => createDiffStore(repo.diffHunks), [repo]);

  // Follow the paper in focus and the jobs store: load the latest completed
  // review for the open paper, and clear when switching to a paper with no
  // review. Subscribing to the jobs store is load-bearing — when a review
  // transitions to `done` (which fires only after `ingestReview` has written
  // rows to `diff_hunks`), we need to re-pick the latest session and load it.
  useEffect(() => {
    const run = (): void => {
      const current = store.getState().sessionId;
      if (!activePaperId) {
        if (current !== null) store.getState().clear();
        return;
      }
      const latest = findLatestDoneReviewForPaper(activePaperId);
      if (!latest) {
        if (current !== null) store.getState().clear();
        return;
      }
      if (current === latest) return;
      void store.getState().load(latest);
    };
    run();
    return useJobsStore.subscribe(run);
  }, [store, activePaperId]);

  return <DiffStoreContext.Provider value={store}>{children}</DiffStoreContext.Provider>;
}

export function useDiffStore(): DiffStore {
  const store = useContext(DiffStoreContext);
  if (!store) throw new Error("useDiffStore requires DiffStoreProvider");
  return store;
}

function findLatestDoneReviewForPaper(paperId: string): string | undefined {
  let bestStartedAt = -1;
  let bestSessionId: string | undefined;
  for (const job of Object.values(useJobsStore.getState().jobs)) {
    if (job.paperId !== paperId) continue;
    if (job.kind !== "review") continue;
    if (job.status !== "done") continue;
    if (!job.reviewSessionId) continue;
    if (job.startedAt > bestStartedAt) {
      bestStartedAt = job.startedAt;
      bestSessionId = job.reviewSessionId;
    }
  }
  return bestSessionId;
}
