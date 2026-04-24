import { useEffect } from "react";
import { useProject } from "./context";
import { useOpenPaper } from "./OpenPaper";
import { useReviewStore } from "./store-context";
import { usePaperEdits } from "./use-paper-edits";

export function useLoadRevision(): void {
  const store = useReviewStore();
  const openPaper = useOpenPaper();
  const { project, repo } = useProject();
  const edits = usePaperEdits(repo, project.id);
  const revisionId =
    openPaper.kind === "ready"
      ? openPaper.revision.id
      : openPaper.kind === "ready-md"
        ? (openPaper.revision?.id ?? null)
        : null;
  const visibleFromEditId = edits.currentDraftId;

  useEffect(() => {
    if (revisionId !== null) {
      void store.getState().load(revisionId, visibleFromEditId);
    }
  }, [revisionId, visibleFromEditId, store]);
}
