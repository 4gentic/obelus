import type { DiffHunkRow, DiffHunkState } from "@obelus/repo";
import { describe, expect, it } from "vitest";
import type { ApplyStatus } from "../../../lib/diff-store";
import { computeApplyGate, fileKey, groupByFile } from "../diff-review-gate";

function hunk(id: string, file: string): DiffHunkRow {
  return {
    id,
    sessionId: "sess-1",
    annotationIds: [],
    file,
    category: null,
    patch: "@@ -1 +1 @@\n-a\n+b\n",
    modifiedPatchText: null,
    state: "pending",
    ambiguous: false,
    emptyReason: null,
    noteText: "",
    reviewerNotes: "",
    ordinal: 0,
    applyFailure: null,
  };
}

function counts(partial: Partial<Record<DiffHunkState, number>>): Record<DiffHunkState, number> {
  return { pending: 0, accepted: 0, rejected: 0, modified: 0, ...partial };
}

describe("fileKey", () => {
  it("returns the file path for a resolved hunk", () => {
    expect(fileKey(hunk("h1", "main.tex"))).toBe("main.tex");
  });

  it("maps the empty file to the (unresolved) bucket", () => {
    expect(fileKey(hunk("h1", ""))).toBe("(unresolved)");
  });
});

describe("groupByFile", () => {
  it("groups hunks under their file key, preserving insertion order per bucket", () => {
    const a1 = hunk("a1", "a.tex");
    const b1 = hunk("b1", "b.tex");
    const a2 = hunk("a2", "a.tex");
    const grouped = groupByFile([a1, b1, a2]);

    expect([...grouped.keys()]).toEqual(["a.tex", "b.tex"]);
    expect(grouped.get("a.tex")).toEqual([a1, a2]);
    expect(grouped.get("b.tex")).toEqual([b1]);
  });

  it("collects empty-file hunks under the (unresolved) key", () => {
    const u1 = hunk("u1", "");
    const u2 = hunk("u2", "");
    const grouped = groupByFile([u1, u2]);

    expect([...grouped.keys()]).toEqual(["(unresolved)"]);
    expect(grouped.get("(unresolved)")).toEqual([u1, u2]);
  });

  it("returns an empty map for no hunks", () => {
    expect(groupByFile([]).size).toBe(0);
  });
});

describe("computeApplyGate", () => {
  const idle: ApplyStatus = { kind: "idle" };

  it("enables bulk + apply when work is pending and accepted, idle and not busy", () => {
    const gate = computeApplyGate({
      applicableCounts: counts({ pending: 1, accepted: 2 }),
      acceptedTotal: 2,
      applyStatus: idle,
      runnerBusy: false,
    });
    expect(gate.bulkAvailable).toBe(true);
    // pending + rejected > 0
    expect(gate.canAcceptAll).toBe(true);
    // pending + accepted > 0
    expect(gate.canRejectAll).toBe(true);
    // pending !== 0 ⇒ not yet applicable
    expect(gate.applicable).toBe(false);
  });

  it("becomes applicable once nothing is pending and something is accepted", () => {
    const gate = computeApplyGate({
      applicableCounts: counts({ accepted: 3 }),
      acceptedTotal: 3,
      applyStatus: idle,
      runnerBusy: false,
    });
    expect(gate.applicable).toBe(true);
    // pending + accepted > 0 (accepted)
    expect(gate.canRejectAll).toBe(true);
    // pending + rejected === 0
    expect(gate.canAcceptAll).toBe(false);
  });

  it("is not applicable when nothing was accepted, even with zero pending", () => {
    const gate = computeApplyGate({
      applicableCounts: counts({ rejected: 4 }),
      acceptedTotal: 0,
      applyStatus: idle,
      runnerBusy: false,
    });
    expect(gate.applicable).toBe(false);
    // pending + rejected > 0 (rejected) ⇒ can still re-accept them
    expect(gate.canAcceptAll).toBe(true);
    expect(gate.canRejectAll).toBe(false);
  });

  it("counts modified hunks toward applicability via acceptedTotal", () => {
    const gate = computeApplyGate({
      applicableCounts: counts({ modified: 2 }),
      acceptedTotal: 2,
      applyStatus: idle,
      runnerBusy: false,
    });
    expect(gate.applicable).toBe(true);
    // modified is neither pending, accepted, nor rejected ⇒ no bulk targets
    expect(gate.canAcceptAll).toBe(false);
    expect(gate.canRejectAll).toBe(false);
  });

  it("closes every gate once an apply is in flight", () => {
    const gate = computeApplyGate({
      applicableCounts: counts({ pending: 1, accepted: 1 }),
      acceptedTotal: 1,
      applyStatus: { kind: "applying" },
      runnerBusy: false,
    });
    expect(gate.bulkAvailable).toBe(false);
    expect(gate.canAcceptAll).toBe(false);
    expect(gate.canRejectAll).toBe(false);
    expect(gate.applicable).toBe(false);
  });

  it("closes every gate after a clean apply", () => {
    const gate = computeApplyGate({
      applicableCounts: counts({ accepted: 3 }),
      acceptedTotal: 3,
      applyStatus: { kind: "applied", filesWritten: 1, hunksApplied: 3 },
      runnerBusy: false,
    });
    expect(gate.bulkAvailable).toBe(false);
    expect(gate.canAcceptAll).toBe(false);
    expect(gate.canRejectAll).toBe(false);
    expect(gate.applicable).toBe(false);
  });

  it("closes every gate after a partial apply", () => {
    const gate = computeApplyGate({
      applicableCounts: counts({ pending: 1, accepted: 2 }),
      acceptedTotal: 2,
      applyStatus: {
        kind: "partial",
        filesWritten: 1,
        hunksApplied: 2,
        hunksFailed: [{ file: "main.tex", index: 0, reason: "no match" }],
      },
      runnerBusy: false,
    });
    expect(gate.bulkAvailable).toBe(false);
    expect(gate.canAcceptAll).toBe(false);
    expect(gate.canRejectAll).toBe(false);
    expect(gate.applicable).toBe(false);
  });

  it("keeps bulk ops available on an error status (a retry is still allowed)", () => {
    const gate = computeApplyGate({
      applicableCounts: counts({ pending: 1, accepted: 1 }),
      acceptedTotal: 1,
      applyStatus: { kind: "error", message: "boom" },
      runnerBusy: false,
    });
    expect(gate.bulkAvailable).toBe(true);
    expect(gate.canAcceptAll).toBe(true);
    expect(gate.canRejectAll).toBe(true);
    // still pending ⇒ not applicable yet
    expect(gate.applicable).toBe(false);
  });

  it("is applicable on an error status once nothing is pending", () => {
    const gate = computeApplyGate({
      applicableCounts: counts({ accepted: 2 }),
      acceptedTotal: 2,
      applyStatus: { kind: "error", message: "boom" },
      runnerBusy: false,
    });
    expect(gate.applicable).toBe(true);
  });

  it("closes every gate while the review runner is busy", () => {
    const gate = computeApplyGate({
      applicableCounts: counts({ accepted: 2 }),
      acceptedTotal: 2,
      applyStatus: idle,
      runnerBusy: true,
    });
    expect(gate.bulkAvailable).toBe(false);
    expect(gate.canAcceptAll).toBe(false);
    expect(gate.canRejectAll).toBe(false);
    expect(gate.applicable).toBe(false);
  });

  it("disables apply when there are no applicable hunks at all", () => {
    const gate = computeApplyGate({
      applicableCounts: counts({}),
      acceptedTotal: 0,
      applyStatus: idle,
      runnerBusy: false,
    });
    expect(gate.bulkAvailable).toBe(true);
    expect(gate.canAcceptAll).toBe(false);
    expect(gate.canRejectAll).toBe(false);
    expect(gate.applicable).toBe(false);
  });
});
