import type { PaperEditRow } from "@obelus/repo";
import { useEffect, useState } from "react";
import { type HistoryDivergenceReport, historyDetectDivergence } from "../../ipc/commands";

export interface DivergenceState {
  dirty: boolean;
  report: HistoryDivergenceReport | null;
  currentOrdinal: number | undefined;
}

// Compares the working tree against the currently-viewed draft's manifest.
// Re-runs when the draft pointer moves (check-outs) and when the manifest
// itself changes (snapshot-after-apply mints a new one). Silent on failure:
// a manifest miss or an IPC error just leaves the banner hidden.
export function useWorkingTreeDivergence(
  rootId: string,
  currentDraft: PaperEditRow | undefined,
): DivergenceState {
  const [report, setReport] = useState<HistoryDivergenceReport | null>(null);
  const manifestSha = currentDraft?.manifestSha256;
  const ordinal = currentDraft?.ordinal;

  useEffect(() => {
    if (!manifestSha) {
      setReport(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const r = await historyDetectDivergence(rootId, manifestSha);
        if (!cancelled) setReport(r);
      } catch {
        if (!cancelled) setReport(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rootId, manifestSha]);

  const dirty =
    report !== null &&
    (report.modified.length > 0 || report.added.length > 0 || report.missing.length > 0);

  return {
    dirty,
    report,
    currentOrdinal: ordinal,
  };
}
