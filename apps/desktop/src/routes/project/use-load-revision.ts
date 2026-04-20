import { useEffect } from "react";
import { useOpenPaper } from "./OpenPaper";
import { useReviewStore } from "./store-context";

export function useLoadRevision(): void {
  const store = useReviewStore();
  const openPaper = useOpenPaper();
  const revisionId = openPaper.kind === "ready" ? openPaper.revision.id : null;

  useEffect(() => {
    if (revisionId !== null) {
      void store.getState().load(revisionId);
    }
  }, [revisionId, store]);
}
