import type { DiffHunkRow, DiffHunkState } from "@obelus/repo";
import type { ApplyStatus } from "../../lib/diff-store";

export function fileKey(h: DiffHunkRow): string {
  return h.file === "" ? "(unresolved)" : h.file;
}

export function groupByFile(hunks: ReadonlyArray<DiffHunkRow>): Map<string, DiffHunkRow[]> {
  const map = new Map<string, DiffHunkRow[]>();
  for (const h of hunks) {
    const key = fileKey(h);
    const bucket = map.get(key) ?? [];
    bucket.push(h);
    map.set(key, bucket);
  }
  return map;
}

export interface ApplyGateInput {
  // Counts over the *applicable* set only — hunks carrying a real patch.
  // Informational hunks (patch === '') are excluded by the caller so they
  // never permanently disable the apply button.
  applicableCounts: Record<DiffHunkState, number>;
  // accepted + modified over the applicable set; the gate's "anything to write"
  // signal even when applicableCounts is empty (reviewer-mode).
  acceptedTotal: number;
  applyStatus: ApplyStatus;
  runnerBusy: boolean;
}

export interface ApplyGate {
  bulkAvailable: boolean;
  canAcceptAll: boolean;
  canRejectAll: boolean;
  applicable: boolean;
}

export function computeApplyGate(input: ApplyGateInput): ApplyGate {
  const { applicableCounts, acceptedTotal, applyStatus, runnerBusy } = input;
  const bulkAvailable =
    applyStatus.kind !== "applying" &&
    applyStatus.kind !== "applied" &&
    applyStatus.kind !== "partial" &&
    !runnerBusy;
  return {
    bulkAvailable,
    canAcceptAll: bulkAvailable && applicableCounts.pending + applicableCounts.rejected > 0,
    canRejectAll: bulkAvailable && applicableCounts.pending + applicableCounts.accepted > 0,
    applicable:
      applicableCounts.pending === 0 &&
      acceptedTotal > 0 &&
      applyStatus.kind !== "applying" &&
      applyStatus.kind !== "applied" &&
      applyStatus.kind !== "partial" &&
      !runnerBusy,
  };
}
