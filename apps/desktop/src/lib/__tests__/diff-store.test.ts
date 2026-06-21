import type {
  DiffHunkApplyFailure,
  DiffHunkRow,
  DiffHunksRepo,
  ReviewSessionsRepo,
} from "@obelus/repo";
import { applyPatch } from "diff";
import { describe, expect, it, vi } from "vitest";
import { createDiffStore, recount } from "../diff-store";

// Only the methods the store's actions call are stubbed; the rest of the repo
// interface is never reached, so casting the partial fake is the boundary's
// honest shape rather than an `any` escape hatch.
function makeRepo(): {
  repo: DiffHunksRepo;
  fns: {
    listForSession: ReturnType<typeof vi.fn>;
    setState: ReturnType<typeof vi.fn>;
    acceptAllInFile: ReturnType<typeof vi.fn>;
    acceptAllInSession: ReturnType<typeof vi.fn>;
    rejectAllInSession: ReturnType<typeof vi.fn>;
    setModifiedPatch: ReturnType<typeof vi.fn>;
    setNote: ReturnType<typeof vi.fn>;
    clearApplyFailures: ReturnType<typeof vi.fn>;
  };
} {
  const fns = {
    listForSession: vi.fn(async (): Promise<DiffHunkRow[]> => []),
    setState: vi.fn(async (): Promise<void> => {}),
    acceptAllInFile: vi.fn(async (): Promise<void> => {}),
    acceptAllInSession: vi.fn(async (): Promise<void> => {}),
    rejectAllInSession: vi.fn(async (): Promise<void> => {}),
    setModifiedPatch: vi.fn(async (): Promise<void> => {}),
    setNote: vi.fn(async (): Promise<void> => {}),
    clearApplyFailures: vi.fn(async (): Promise<void> => {}),
  };
  return { repo: fns as unknown as DiffHunksRepo, fns };
}

function makeReviewSessions(): {
  reviewSessions: ReviewSessionsRepo;
  markApplied: ReturnType<typeof vi.fn>;
} {
  const markApplied = vi.fn(async (): Promise<void> => {});
  return {
    reviewSessions: { markApplied } as unknown as ReviewSessionsRepo,
    markApplied,
  };
}

function hunk(overrides: Partial<DiffHunkRow> & Pick<DiffHunkRow, "id">): DiffHunkRow {
  return {
    sessionId: "sess-1",
    annotationIds: [overrides.id],
    file: "main.tex",
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
    ...overrides,
  };
}

describe("recount", () => {
  it("tallies each state, defaulting absent states to zero", () => {
    const hunks = [
      hunk({ id: "h1", state: "pending" }),
      hunk({ id: "h2", state: "pending" }),
      hunk({ id: "h3", state: "accepted" }),
      hunk({ id: "h4", state: "rejected" }),
      hunk({ id: "h5", state: "modified" }),
    ];
    expect(recount(hunks)).toEqual({ pending: 2, accepted: 1, rejected: 1, modified: 1 });
  });

  it("returns all zeros for no hunks", () => {
    expect(recount([])).toEqual({ pending: 0, accepted: 0, rejected: 0, modified: 0 });
  });
});

describe("createDiffStore — load + accept/reject", () => {
  it("loads a session, seeding hunks, counts, and clearing edit/note state", async () => {
    const { repo, fns } = makeRepo();
    const { reviewSessions } = makeReviewSessions();
    const rows = [hunk({ id: "h1" }), hunk({ id: "h2", state: "accepted" })];
    fns.listForSession.mockResolvedValueOnce(rows);
    const store = createDiffStore(repo, reviewSessions);

    await store.getState().load("sess-1");

    const s = store.getState();
    expect(fns.listForSession).toHaveBeenCalledWith("sess-1");
    expect(s.sessionId).toBe("sess-1");
    expect(s.hunks).toEqual(rows);
    expect(s.counts).toEqual({ pending: 1, accepted: 1, rejected: 0, modified: 0 });
    expect(s.focusedIndex).toBe(0);
    expect(s.editingId).toBeNull();
  });

  it("accepts a hunk by explicit id", async () => {
    const { repo, fns } = makeRepo();
    const { reviewSessions } = makeReviewSessions();
    fns.listForSession.mockResolvedValueOnce([hunk({ id: "h1" }), hunk({ id: "h2" })]);
    const store = createDiffStore(repo, reviewSessions);
    await store.getState().load("sess-1");

    await store.getState().accept("h2");

    expect(fns.setState).toHaveBeenCalledWith("h2", "accepted");
    const s = store.getState();
    expect(s.hunks.find((h) => h.id === "h2")?.state).toBe("accepted");
    expect(s.hunks.find((h) => h.id === "h1")?.state).toBe("pending");
    expect(s.counts).toEqual({ pending: 1, accepted: 1, rejected: 0, modified: 0 });
  });

  it("rejects the focused hunk when no id is given", async () => {
    const { repo, fns } = makeRepo();
    const { reviewSessions } = makeReviewSessions();
    fns.listForSession.mockResolvedValueOnce([hunk({ id: "h1" }), hunk({ id: "h2" })]);
    const store = createDiffStore(repo, reviewSessions);
    await store.getState().load("sess-1");
    store.getState().focus(1);

    await store.getState().reject();

    expect(fns.setState).toHaveBeenCalledWith("h2", "rejected");
    expect(store.getState().hunks.find((h) => h.id === "h2")?.state).toBe("rejected");
  });

  it("is a no-op when accepting with no hunks loaded", async () => {
    const { repo, fns } = makeRepo();
    const { reviewSessions } = makeReviewSessions();
    const store = createDiffStore(repo, reviewSessions);

    await store.getState().accept();

    expect(fns.setState).not.toHaveBeenCalled();
  });
});

describe("createDiffStore — bulk ops skip informational hunks", () => {
  it("acceptFile flips pending/rejected real patches, leaving empty-patch notes pending", async () => {
    const { repo, fns } = makeRepo();
    const { reviewSessions } = makeReviewSessions();
    fns.listForSession.mockResolvedValueOnce([
      hunk({ id: "h1", file: "a.tex", state: "pending" }),
      hunk({ id: "h2", file: "a.tex", state: "rejected" }),
      hunk({ id: "note", file: "a.tex", state: "pending", patch: "" }),
      hunk({ id: "other", file: "b.tex", state: "pending" }),
    ]);
    const store = createDiffStore(repo, reviewSessions);
    await store.getState().load("sess-1");

    await store.getState().acceptFile("a.tex");

    expect(fns.acceptAllInFile).toHaveBeenCalledWith("sess-1", "a.tex");
    const byId = new Map(store.getState().hunks.map((h) => [h.id, h.state]));
    expect(byId.get("h1")).toBe("accepted");
    expect(byId.get("h2")).toBe("accepted");
    // Empty-patch note stays pending; the SQL guard skips it.
    expect(byId.get("note")).toBe("pending");
    // Different file untouched.
    expect(byId.get("other")).toBe("pending");
  });

  it("acceptAll flips every real patch across files but never the empty-patch notes", async () => {
    const { repo, fns } = makeRepo();
    const { reviewSessions } = makeReviewSessions();
    fns.listForSession.mockResolvedValueOnce([
      hunk({ id: "h1", state: "pending" }),
      hunk({ id: "h2", state: "rejected", file: "b.tex" }),
      hunk({ id: "note", state: "pending", patch: "" }),
    ]);
    const store = createDiffStore(repo, reviewSessions);
    await store.getState().load("sess-1");

    await store.getState().acceptAll();

    expect(fns.acceptAllInSession).toHaveBeenCalledWith("sess-1");
    const byId = new Map(store.getState().hunks.map((h) => [h.id, h.state]));
    expect(byId.get("h1")).toBe("accepted");
    expect(byId.get("h2")).toBe("accepted");
    expect(byId.get("note")).toBe("pending");
  });

  it("rejectAll flips every real patch but never the empty-patch notes", async () => {
    const { repo, fns } = makeRepo();
    const { reviewSessions } = makeReviewSessions();
    fns.listForSession.mockResolvedValueOnce([
      hunk({ id: "h1", state: "pending" }),
      hunk({ id: "h2", state: "accepted" }),
      hunk({ id: "note", state: "pending", patch: "" }),
    ]);
    const store = createDiffStore(repo, reviewSessions);
    await store.getState().load("sess-1");

    await store.getState().rejectAll();

    expect(fns.rejectAllInSession).toHaveBeenCalledWith("sess-1");
    const byId = new Map(store.getState().hunks.map((h) => [h.id, h.state]));
    expect(byId.get("h1")).toBe("rejected");
    expect(byId.get("h2")).toBe("rejected");
    expect(byId.get("note")).toBe("pending");
  });
});

describe("createDiffStore — focus", () => {
  it("clamps focus to [0, len-1]", async () => {
    const { repo, fns } = makeRepo();
    const { reviewSessions } = makeReviewSessions();
    fns.listForSession.mockResolvedValueOnce([
      hunk({ id: "h1" }),
      hunk({ id: "h2" }),
      hunk({ id: "h3" }),
    ]);
    const store = createDiffStore(repo, reviewSessions);
    await store.getState().load("sess-1");

    store.getState().focus(-5);
    expect(store.getState().focusedIndex).toBe(0);

    store.getState().focus(99);
    expect(store.getState().focusedIndex).toBe(2);

    store.getState().focus(1);
    expect(store.getState().focusedIndex).toBe(1);
  });

  it("focus is a no-op with no hunks", () => {
    const { repo } = makeRepo();
    const { reviewSessions } = makeReviewSessions();
    const store = createDiffStore(repo, reviewSessions);

    store.getState().focus(3);

    expect(store.getState().focusedIndex).toBe(0);
  });
});

describe("createDiffStore — note flow", () => {
  it("seeds the editor from the hunk's note, then persists on commit", async () => {
    const { repo, fns } = makeRepo();
    const { reviewSessions } = makeReviewSessions();
    fns.listForSession.mockResolvedValueOnce([hunk({ id: "h1", noteText: "seed note" })]);
    const store = createDiffStore(repo, reviewSessions);
    await store.getState().load("sess-1");

    store.getState().startNote("h1");
    expect(store.getState().noteId).toBe("h1");
    expect(store.getState().noteText).toBe("seed note");

    store.getState().setNoteText("revised pushback");
    await store.getState().commitNote();

    expect(fns.setNote).toHaveBeenCalledWith("h1", "revised pushback");
    const s = store.getState();
    expect(s.noteId).toBeNull();
    expect(s.noteText).toBe("");
    expect(s.hunks.find((h) => h.id === "h1")?.noteText).toBe("revised pushback");
  });

  it("cancelNote drops the draft without touching the repo", async () => {
    const { repo, fns } = makeRepo();
    const { reviewSessions } = makeReviewSessions();
    fns.listForSession.mockResolvedValueOnce([hunk({ id: "h1", noteText: "keep me" })]);
    const store = createDiffStore(repo, reviewSessions);
    await store.getState().load("sess-1");

    store.getState().startNote("h1");
    store.getState().setNoteText("discarded");
    store.getState().cancelNote();

    expect(fns.setNote).not.toHaveBeenCalled();
    const s = store.getState();
    expect(s.noteId).toBeNull();
    expect(s.hunks.find((h) => h.id === "h1")?.noteText).toBe("keep me");
  });
});

describe("createDiffStore — apply-status transitions", () => {
  it("markApplied clears the session and records the applied banner", async () => {
    const { repo, fns } = makeRepo();
    const { reviewSessions } = makeReviewSessions();
    fns.listForSession.mockResolvedValueOnce([hunk({ id: "h1" })]);
    const store = createDiffStore(repo, reviewSessions);
    await store.getState().load("sess-1");

    store.getState().markApplied({ filesWritten: 2, hunksApplied: 3, draftOrdinal: 4 });

    const s = store.getState();
    expect(s.sessionId).toBeNull();
    expect(s.hunks).toEqual([]);
    expect(s.applyStatus).toEqual({
      kind: "applied",
      filesWritten: 2,
      hunksApplied: 3,
      draftOrdinal: 4,
    });
  });

  it("markApplied omits draftOrdinal when undefined (exactOptionalPropertyTypes)", async () => {
    const { repo, fns } = makeRepo();
    const { reviewSessions } = makeReviewSessions();
    fns.listForSession.mockResolvedValueOnce([hunk({ id: "h1" })]);
    const store = createDiffStore(repo, reviewSessions);
    await store.getState().load("sess-1");

    store.getState().markApplied({ filesWritten: 1, hunksApplied: 1 });

    expect(store.getState().applyStatus).toEqual({
      kind: "applied",
      filesWritten: 1,
      hunksApplied: 1,
    });
  });

  it("markPartialApplied tags failing hunks and surfaces a partial banner", async () => {
    const { repo, fns } = makeRepo();
    const { reviewSessions } = makeReviewSessions();
    fns.listForSession.mockResolvedValueOnce([hunk({ id: "h1" }), hunk({ id: "h2" })]);
    const store = createDiffStore(repo, reviewSessions);
    await store.getState().load("sess-1");

    const failure: DiffHunkApplyFailure = {
      reason: "no match in current source",
      attemptedAt: "2026-01-01T00:00:00",
    };
    store.getState().markPartialApplied({
      filesWritten: 1,
      hunksApplied: 1,
      failuresByHunkId: new Map([["h2", failure]]),
      failures: [{ file: "main.tex", index: 1, reason: failure.reason }],
    });

    const s = store.getState();
    expect(s.hunks.find((h) => h.id === "h1")?.applyFailure).toBeNull();
    expect(s.hunks.find((h) => h.id === "h2")?.applyFailure).toEqual(failure);
    expect(s.applyStatus).toEqual({
      kind: "partial",
      filesWritten: 1,
      hunksApplied: 1,
      hunksFailed: [{ file: "main.tex", index: 1, reason: failure.reason }],
    });
  });

  it("dismissApplyFailures marks the session applied, clears markers, and resets to applied", async () => {
    const { repo, fns } = makeRepo();
    const { reviewSessions, markApplied } = makeReviewSessions();
    fns.listForSession.mockResolvedValueOnce([hunk({ id: "h1" }), hunk({ id: "h2" })]);
    const store = createDiffStore(repo, reviewSessions);
    await store.getState().load("sess-1");
    store.getState().markPartialApplied({
      filesWritten: 1,
      hunksApplied: 1,
      draftOrdinal: 7,
      failuresByHunkId: new Map([["h2", { reason: "stale", attemptedAt: "2026-01-01T00:00:00" }]]),
      failures: [{ file: "main.tex", index: 1, reason: "stale" }],
    });

    await store.getState().dismissApplyFailures();

    expect(markApplied).toHaveBeenCalledWith("sess-1");
    expect(fns.clearApplyFailures).toHaveBeenCalledWith("sess-1");
    const s = store.getState();
    expect(s.sessionId).toBeNull();
    expect(s.hunks).toEqual([]);
    expect(s.applyStatus).toEqual({
      kind: "applied",
      filesWritten: 1,
      hunksApplied: 1,
      draftOrdinal: 7,
    });
  });

  it("dismissApplyFailures is a no-op unless the status is partial", async () => {
    const { repo, fns } = makeRepo();
    const { reviewSessions, markApplied } = makeReviewSessions();
    fns.listForSession.mockResolvedValueOnce([hunk({ id: "h1" })]);
    const store = createDiffStore(repo, reviewSessions);
    await store.getState().load("sess-1");

    await store.getState().dismissApplyFailures();

    expect(markApplied).not.toHaveBeenCalled();
    expect(fns.clearApplyFailures).not.toHaveBeenCalled();
    expect(store.getState().sessionId).toBe("sess-1");
  });
});

describe("createDiffStore — edit round-trip (synthesizePatch regression)", () => {
  // A real bug: editing a hunk whose splice leaves a long unchanged middle made
  // structuredPatch emit two hunks. A DiffHunkRow holds exactly one `@@`; the
  // un-coalesced second header leaked into the stored patch, and on re-edit
  // parseChange's `after` came back with diff syntax baked in. This drives the
  // whole store path: synthesizePatch → setModifiedPatch → parseChange.
  const SRC_LINES = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`);
  const source = `${SRC_LINES.join("\n")}\n`;
  // Coarse whole-region patch: the edit will splice over lines 1..12.
  const wholeRegionPatch = `@@ -1,12 +1,12 @@\n${SRC_LINES.map((l) => `-${l}`).join(
    "\n",
  )}\n${SRC_LINES.map((l) => `+${l}`).join("\n")}\n`;
  // Change only the first and last line; lines 2..11 stay identical — a 10-line
  // unchanged gap, wider than jsdiff's default context, so it would split.
  const editedLines = [...SRC_LINES];
  editedLines[0] = "LINE ONE CHANGED";
  editedLines[11] = "LINE TWELVE CHANGED";
  const editedAfter = editedLines.join("\n");
  const intendedFile = `${editedLines.join("\n")}\n`;

  it("coalesces a split edit into one hunk that applies and re-seeds cleanly", async () => {
    const { repo, fns } = makeRepo();
    const { reviewSessions } = makeReviewSessions();
    fns.listForSession.mockResolvedValueOnce([hunk({ id: "h1", patch: wholeRegionPatch })]);
    const store = createDiffStore(repo, reviewSessions);
    await store.getState().load("sess-1");

    store.getState().startEdit("h1", source);
    store.getState().setEditingText(editedAfter);
    await store.getState().commitEdit(source);

    const stored = fns.setModifiedPatch.mock.calls[0]?.[1];
    expect(typeof stored).toBe("string");
    const modifiedPatchText = stored as string;
    // Exactly one hunk header survives — the coalesce held.
    expect(modifiedPatchText.match(/^@@ /gm)?.length).toBe(1);
    // The single coalesced patch round-trips to the intended file.
    expect(applyPatch(source, modifiedPatchText)).toBe(intendedFile);

    const committed = store.getState();
    expect(committed.hunks[0]?.state).toBe("modified");
    expect(committed.hunks[0]?.modifiedPatchText).toBe(modifiedPatchText);

    // Re-open the editor: the seed must be the edited prose, never diff syntax.
    store.getState().startEdit("h1", source);
    const reseeded = store.getState().editingText;
    expect(reseeded).toBe(editedAfter);
    expect(reseeded).not.toContain("@@");
    expect(reseeded).not.toContain("@ -");
  });

  it("commitEdit with no source stores the edited text verbatim", async () => {
    const { repo, fns } = makeRepo();
    const { reviewSessions } = makeReviewSessions();
    fns.listForSession.mockResolvedValueOnce([hunk({ id: "h1" })]);
    const store = createDiffStore(repo, reviewSessions);
    await store.getState().load("sess-1");

    store.getState().startEdit("h1", null);
    store.getState().setEditingText("free-form note");
    await store.getState().commitEdit(null);

    expect(fns.setModifiedPatch).toHaveBeenCalledWith("h1", "free-form note");
    expect(store.getState().hunks[0]?.modifiedPatchText).toBe("free-form note");
  });

  it("cancelEdit drops the draft without writing", async () => {
    const { repo, fns } = makeRepo();
    const { reviewSessions } = makeReviewSessions();
    fns.listForSession.mockResolvedValueOnce([hunk({ id: "h1" })]);
    const store = createDiffStore(repo, reviewSessions);
    await store.getState().load("sess-1");

    store.getState().startEdit("h1", source);
    store.getState().setEditingText("nope");
    store.getState().cancelEdit();

    expect(fns.setModifiedPatch).not.toHaveBeenCalled();
    expect(store.getState().editingId).toBeNull();
    expect(store.getState().editingText).toBe("");
  });
});
