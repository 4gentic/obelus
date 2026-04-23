import type { AnnotationRow, AnnotationsRepo } from "@obelus/repo";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createReviewStore } from "../index";

function makeRow(overrides: Partial<AnnotationRow> = {}): AnnotationRow {
  return {
    id: "a1",
    revisionId: "rev-1",
    category: "unclear",
    quote: "the thing",
    contextBefore: "",
    contextAfter: "",
    page: 1,
    bbox: [0, 0, 100, 20],
    textItemRange: { start: [0, 0], end: [0, 9] },
    note: "",
    thread: [],
    createdAt: "2026-04-23T00:00:00.000Z",
    ...overrides,
  };
}

function makeRepo(initial: AnnotationRow[]): {
  repo: AnnotationsRepo;
  bulkPut: ReturnType<typeof vi.fn>;
} {
  const bulkPut = vi.fn().mockResolvedValue(undefined);
  const repo: AnnotationsRepo = {
    listForRevision: vi.fn().mockResolvedValue(initial),
    bulkPut,
    remove: vi.fn().mockResolvedValue(undefined),
    markResolvedInEdit: vi.fn().mockResolvedValue(undefined),
  };
  return { repo, bulkPut };
}

describe("updateAnnotation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mirrors category across grouped siblings", async () => {
    const sibA = makeRow({ id: "a", page: 1, groupId: "g1", category: "unclear" });
    const sibB = makeRow({ id: "b", page: 2, groupId: "g1", category: "unclear" });
    const { repo, bulkPut } = makeRepo([sibA, sibB]);
    const useStore = createReviewStore(repo);
    await useStore.getState().load("rev-1");

    await useStore.getState().updateAnnotation("a", { category: "rephrase" });

    expect(bulkPut).toHaveBeenCalledTimes(1);
    const [, persisted] = bulkPut.mock.calls[0] as [string, AnnotationRow[]];
    expect(persisted.map((r) => r.category)).toEqual(["rephrase", "rephrase"]);

    const state = useStore.getState().annotations;
    expect(state.find((r) => r.id === "a")?.category).toBe("rephrase");
    expect(state.find((r) => r.id === "b")?.category).toBe("rephrase");
  });

  it("mirrors note across grouped siblings (regression)", async () => {
    const sibA = makeRow({ id: "a", page: 1, groupId: "g1", note: "" });
    const sibB = makeRow({ id: "b", page: 2, groupId: "g1", note: "" });
    const { repo, bulkPut } = makeRepo([sibA, sibB]);
    const useStore = createReviewStore(repo);
    await useStore.getState().load("rev-1");

    await useStore.getState().updateAnnotation("a", { note: "shared note" });

    const [, persisted] = bulkPut.mock.calls[0] as [string, AnnotationRow[]];
    expect(persisted.map((r) => r.note)).toEqual(["shared note", "shared note"]);
  });

  it("mirrors category and note in a single bulkPut", async () => {
    const sibA = makeRow({ id: "a", page: 1, groupId: "g1" });
    const sibB = makeRow({ id: "b", page: 2, groupId: "g1" });
    const { repo, bulkPut } = makeRepo([sibA, sibB]);
    const useStore = createReviewStore(repo);
    await useStore.getState().load("rev-1");

    await useStore.getState().updateAnnotation("a", { category: "wrong", note: "see fig 3" });

    expect(bulkPut).toHaveBeenCalledTimes(1);
    const [, persisted] = bulkPut.mock.calls[0] as [string, AnnotationRow[]];
    expect(persisted).toHaveLength(2);
    for (const row of persisted) {
      expect(row.category).toBe("wrong");
      expect(row.note).toBe("see fig 3");
    }
  });

  it("writes only the single row when ungrouped", async () => {
    const row = makeRow({ id: "solo" });
    const { repo, bulkPut } = makeRepo([row]);
    const useStore = createReviewStore(repo);
    await useStore.getState().load("rev-1");

    await useStore.getState().updateAnnotation("solo", { category: "praise" });

    expect(bulkPut).toHaveBeenCalledTimes(1);
    const [, persisted] = bulkPut.mock.calls[0] as [string, AnnotationRow[]];
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.id).toBe("solo");
    expect(persisted[0]?.category).toBe("praise");
  });

  it("is a no-op for a resolved mark", async () => {
    const row = makeRow({ id: "done", resolvedInEditId: "edit-1", category: "unclear" });
    const { repo, bulkPut } = makeRepo([row]);
    const useStore = createReviewStore(repo);
    await useStore.getState().load("rev-1");

    await useStore.getState().updateAnnotation("done", { category: "rephrase" });

    expect(bulkPut).not.toHaveBeenCalled();
    expect(useStore.getState().annotations[0]?.category).toBe("unclear");
  });
});
