import { describe, expect, it } from "vitest";
import {
  isSynthesisedAnnotationId,
  partitionPlanBlocks,
  SYNTHESISED_ID_PREFIXES,
} from "../ingest-plan";

describe("isSynthesisedAnnotationId", () => {
  it("recognises every synthesised prefix the planner can emit", () => {
    const samples = [
      "cascade-12345678-1",
      "impact-12345678-1",
      "coherence-1",
      "quality-01-introduction-1",
    ];
    for (const id of samples) {
      expect(isSynthesisedAnnotationId(id)).toBe(true);
    }
  });

  it("does not misclassify user-mark UUIDs as synthesised", () => {
    expect(isSynthesisedAnnotationId("550e8400-e29b-41d4-a716-446655440001")).toBe(false);
  });

  it("keeps the prefix list in sync with the planner contract", () => {
    expect(new Set(SYNTHESISED_ID_PREFIXES)).toEqual(
      new Set(["cascade-", "impact-", "coherence-", "quality-"]),
    );
  });
});

describe("partitionPlanBlocks", () => {
  it("keeps user-mark blocks whose id is in knownAnnotationIds", () => {
    const knownId = "550e8400-e29b-41d4-a716-446655440001";
    const blocks = [{ annotationId: knownId }, { annotationId: "550e8400-unknown" }];
    const result = partitionPlanBlocks(blocks, new Set([knownId]));
    expect(result.kept.map((b) => b.annotationId)).toEqual([knownId]);
    expect(result.droppedForUnknownAnnotation).toEqual(["550e8400-unknown"]);
    expect(result.synthesisedKept).toBe(0);
  });

  // This is the regression test for the bug that silently dropped every cascade-/impact-/
  // coherence-/quality-* block. The SKILL contract promises these blocks reach the diff-
  // review UI; without the synthesised-ID allowlist the knownAnnotationIds gate in the
  // filter silently discarded them, breaking the cascade/impact/quality surfaces end-to-end.
  it("keeps synthesised blocks even when knownAnnotationIds is empty", () => {
    const blocks = [
      { annotationId: "cascade-abcd1234-1" },
      { annotationId: "cascade-abcd1234-2" },
      { annotationId: "impact-abcd1234-1" },
      { annotationId: "coherence-1" },
      { annotationId: "quality-01-introduction-1" },
      { annotationId: "quality-02-approach-1" },
    ];
    const result = partitionPlanBlocks(blocks, new Set<string>());
    expect(result.kept.length).toBe(blocks.length);
    expect(result.droppedForUnknownAnnotation).toEqual([]);
    expect(result.synthesisedKept).toBe(blocks.length);
  });

  it("keeps user-mark and synthesised blocks together, dropping only truly unknown ids", () => {
    const userId = "550e8400-e29b-41d4-a716-446655440001";
    const blocks = [
      { annotationId: userId },
      { annotationId: "cascade-abcd1234-1" },
      { annotationId: "quality-intro-1" },
      { annotationId: "stale-annotation-from-old-bundle" },
    ];
    const result = partitionPlanBlocks(blocks, new Set([userId]));
    expect(result.kept.map((b) => b.annotationId)).toEqual([
      userId,
      "cascade-abcd1234-1",
      "quality-intro-1",
    ]);
    expect(result.droppedForUnknownAnnotation).toEqual(["stale-annotation-from-old-bundle"]);
    expect(result.synthesisedKept).toBe(2);
  });
});
