import type { PaperEditRow, Repository } from "@obelus/repo";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { type HistoryDivergenceReport, historyDetectDivergence } from "../../ipc/commands";

export interface DivergenceState {
  dirty: boolean;
  report: HistoryDivergenceReport | null;
  currentOrdinal: number | undefined;
  dismiss(): Promise<void>;
}

const DismissedFingerprintSchema = z.string();

const DISMISSED_KEY = (paperId: string): string =>
  `paper.${paperId}.divergenceDismissedFingerprint`;

function fingerprint(report: HistoryDivergenceReport): string {
  return [
    ...report.modified.map((p) => `M:${p}`),
    ...report.added.map((p) => `A:${p}`),
    ...report.missing.map((p) => `D:${p}`),
  ]
    .sort()
    .join("\n");
}

// Compares the working tree against the currently-viewed draft's manifest.
// Re-runs when the draft pointer moves (check-outs) and when the manifest
// itself changes (snapshot-after-apply mints a new one). Silent on failure:
// a manifest miss or an IPC error just leaves the banner hidden.
export function useWorkingTreeDivergence(
  rootId: string,
  projectId: string,
  currentDraft: PaperEditRow | undefined,
  repo: Repository,
  paperId: string | null,
): DivergenceState {
  const [report, setReport] = useState<HistoryDivergenceReport | null>(null);
  const [dismissedFp, setDismissedFp] = useState<string | undefined | null>(null);
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
        const r = await historyDetectDivergence(rootId, projectId, manifestSha);
        if (!cancelled) setReport(r);
      } catch {
        if (!cancelled) setReport(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rootId, projectId, manifestSha]);

  useEffect(() => {
    if (!paperId) {
      setDismissedFp(undefined);
      return;
    }
    setDismissedFp(null);
    let cancelled = false;
    void (async () => {
      const fp = await repo.settings.get(DISMISSED_KEY(paperId), DismissedFingerprintSchema);
      if (!cancelled) setDismissedFp(fp);
    })();
    return () => {
      cancelled = true;
    };
  }, [repo, paperId]);

  const hasChanges =
    report !== null &&
    (report.modified.length > 0 || report.added.length > 0 || report.missing.length > 0);
  const currentFp = report !== null && hasChanges ? fingerprint(report) : undefined;
  const dirty = hasChanges && dismissedFp !== null && currentFp !== dismissedFp;

  const dismiss = useCallback(async (): Promise<void> => {
    if (!paperId || !currentFp) return;
    await repo.settings.set(DISMISSED_KEY(paperId), currentFp);
    setDismissedFp(currentFp);
  }, [repo, paperId, currentFp]);

  return {
    dirty,
    report,
    currentOrdinal: ordinal,
    dismiss,
  };
}
