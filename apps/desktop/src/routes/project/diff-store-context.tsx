import type { JSX } from "react";
import { createContext, type ReactNode, useContext, useEffect, useMemo } from "react";
import { createDiffStore, type DiffStore } from "../../lib/diff-store";
import { useJobsStore } from "../../lib/jobs-store";
import { useProject } from "./context";

const DiffStoreContext = createContext<DiffStore | null>(null);

export function DiffStoreProvider({ children }: { children: ReactNode }): JSX.Element {
  const { repo, project } = useProject();
  const store = useMemo(() => createDiffStore(repo.diffHunks), [repo]);

  // If a review ran while the user was away (or on another project), this
  // provider mounts empty — but the hunks already exist in the DB. Look for
  // the most recent completed review job for this project and load it. The
  // in-route runner also calls `load` on completion; guard against a redundant
  // reload via the `sessionId` already-loaded check.
  useEffect(() => {
    const latest = findLatestDoneReview(project.id);
    if (!latest) return;
    const current = store.getState().sessionId;
    if (current === latest) return;
    void store.getState().load(latest);
  }, [store, project.id]);

  return <DiffStoreContext.Provider value={store}>{children}</DiffStoreContext.Provider>;
}

export function useDiffStore(): DiffStore {
  const store = useContext(DiffStoreContext);
  if (!store) throw new Error("useDiffStore requires DiffStoreProvider");
  return store;
}

function findLatestDoneReview(projectId: string): string | undefined {
  let bestStartedAt = -1;
  let bestSessionId: string | undefined;
  for (const job of Object.values(useJobsStore.getState().jobs)) {
    if (job.projectId !== projectId) continue;
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
