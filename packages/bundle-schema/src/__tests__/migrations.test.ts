import { describe, expect, it } from "vitest";
import { migrateV1ToV2 } from "../migrations.js";
import { BundleV2 } from "../schema-v2.js";
import type { Bundle } from "../types.js";

const PAPER_ID = "550e8400-e29b-41d4-a716-446655440000";
const ANNOTATION_ID = "550e8400-e29b-41d4-a716-446655440001";

const v1Bundle: Bundle = {
  bundleVersion: "1.0",
  tool: { name: "obelus", version: "0.1.0" },
  pdf: {
    sha256: "a".repeat(64),
    filename: "paper.pdf",
    pageCount: 12,
  },
  paper: {
    id: PAPER_ID,
    title: "On the Obelization of Generated Prose",
    revision: 3,
    createdAt: "2026-04-17T09:00:00.000Z",
  },
  annotations: [
    {
      id: ANNOTATION_ID,
      category: "unclear",
      quote: "...scalability is achieved by design.",
      contextBefore: "In this section we describe the approach where ",
      contextAfter: " This is demonstrated in the next experiment.",
      page: 4,
      bbox: [72, 420, 540, 432],
      textItemRange: { start: [12, 0], end: [14, 31] },
      note: "By what definition of scalability?",
      thread: [],
      createdAt: "2026-04-17T09:05:00.000Z",
    },
  ],
};

describe("migrateV1ToV2", () => {
  it("produces a bundle that validates as BundleV2", () => {
    const migrated = migrateV1ToV2(v1Bundle);
    expect(BundleV2.safeParse(migrated).success).toBe(true);
    expect(migrated.bundleVersion).toBe("2.0");
  });

  it("collapses v1 pdf+paper into a single papers[] entry", () => {
    const migrated = migrateV1ToV2(v1Bundle);
    expect(migrated.papers).toHaveLength(1);
    const [paper] = migrated.papers;
    expect(paper?.id).toBe(PAPER_ID);
    expect(paper?.title).toBe("On the Obelization of Generated Prose");
    expect(paper?.pdf?.relPath).toBe("paper.pdf");
    expect(paper?.pdf?.sha256).toBe("a".repeat(64));
    expect(paper?.pdf?.pageCount).toBe(12);
  });

  it("translates each annotation's page/bbox/textItemRange into a pdf anchor", () => {
    const migrated = migrateV1ToV2(v1Bundle);
    const [annotation] = migrated.annotations;
    expect(annotation?.paperId).toBe(PAPER_ID);
    expect(annotation?.anchor).toEqual({
      kind: "pdf",
      page: 4,
      bbox: [72, 420, 540, 432],
      textItemRange: { start: [12, 0], end: [14, 31] },
    });
  });

  it("synthesises project.categories from the v1 categories actually used", () => {
    const migrated = migrateV1ToV2(v1Bundle);
    expect(migrated.project.categories).toEqual([{ slug: "unclear", label: "unclear" }]);
    expect(migrated.project.kind).toBe("reviewer");
    expect(migrated.project.label).toBe("On the Obelization of Generated Prose");
  });

  it("derives project.id from the v1 paper.id so the migration is idempotent", () => {
    const a = migrateV1ToV2(v1Bundle);
    const b = migrateV1ToV2(v1Bundle);
    expect(a.project.id).toBe(PAPER_ID);
    expect(b.project.id).toBe(PAPER_ID);
  });

  it("falls back to a default category when the v1 bundle has no annotations", () => {
    const empty: Bundle = { ...v1Bundle, annotations: [] };
    const migrated = migrateV1ToV2(empty);
    expect(migrated.project.categories).toEqual([{ slug: "unclear", label: "unclear" }]);
    expect(migrated.annotations).toEqual([]);
  });

  it("rejects a non-v1 input with a Zod parse error, not undefined behaviour", () => {
    expect(() => migrateV1ToV2({ bundleVersion: "2.0" })).toThrow();
    expect(() => migrateV1ToV2(null)).toThrow();
  });

  it("surfaces an invalid v1 filename as a v2 relPath validation error", () => {
    const bad: Bundle = {
      ...v1Bundle,
      pdf: { ...v1Bundle.pdf, filename: "/etc/passwd" },
    };
    expect(() => migrateV1ToV2(bad)).toThrow();
  });
});
