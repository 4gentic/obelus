import type { AnnotationRow } from "@obelus/repo";
import { describe, expect, it } from "vitest";
import { resolveCollisions } from "../MarginGutter";

type Desired = { row: AnnotationRow; desiredTop: number };

function makeRow(id: string): AnnotationRow {
  return {
    id,
    revisionId: "rev",
    category: "unclear",
    quote: "q",
    contextBefore: "",
    contextAfter: "",
    anchor: {
      kind: "pdf",
      page: 1,
      bbox: [0, 0, 1, 1],
      textItemRange: { start: [0, 0], end: [0, 1] },
    },
    note: "",
    thread: [],
    createdAt: "2026-01-01T00:00:00Z",
  };
}

function desired(pairs: ReadonlyArray<readonly [string, number]>): Desired[] {
  return pairs.map(([id, top]) => ({ row: makeRow(id), desiredTop: top }));
}

describe("resolveCollisions", () => {
  it("keeps desired tops when notes don't overlap", () => {
    const d = desired([
      ["a", 0],
      ["b", 100],
    ]);
    const heights = new Map([
      ["a", 40],
      ["b", 40],
    ]);
    const out = resolveCollisions(d, heights);
    expect(out).toEqual({ a: 0, b: 100 });
  });

  it("pushes the later note down to clear the previous one plus the gap", () => {
    const d = desired([
      ["a", 0],
      ["b", 30],
    ]);
    const heights = new Map([
      ["a", 40],
      ["b", 40],
    ]);
    const out = resolveCollisions(d, heights);
    // a sits at 0, bottom at 40, so b must start at 48 (40 + NOTE_GAP(8))
    expect(out.a).toBe(0);
    expect(out.b).toBe(48);
  });

  it("cascades pushes across many close-together notes", () => {
    const d = desired([
      ["a", 0],
      ["b", 10],
      ["c", 20],
    ]);
    const heights = new Map([
      ["a", 50],
      ["b", 30],
      ["c", 20],
    ]);
    const out = resolveCollisions(d, heights);
    expect(out.a).toBe(0);
    expect(out.b).toBe(58); // a bottom (50) + gap (8)
    expect(out.c).toBe(96); // b bottom (88) + gap (8)
  });

  it("falls back to a safe height estimate when a ref isn't populated", () => {
    const d = desired([
      ["a", 0],
      ["b", 10],
    ]);
    const heights = new Map<string, number>();
    const out = resolveCollisions(d, heights);
    expect(out.a).toBe(0);
    // fallback 64 + gap 8
    expect(out.b).toBe(72);
  });
});
