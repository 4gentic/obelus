import { describe, expect, it } from "vitest";
import { buildBundleV2 } from "../index";

const SHA = "a".repeat(64);
const PAPER_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "99999999-9999-4999-8999-999999999999";
const ANN_ID = "33333333-3333-4333-8333-333333333333";

function seed() {
  const createdAt = "2026-04-19T12:00:00.000Z";
  return {
    project: {
      id: PROJECT_ID,
      label: "Phase 3 Project",
      kind: "folder" as const,
      categories: [
        { slug: "unclear", label: "unclear" },
        { slug: "praise", label: "praise", color: "#6B655A" },
      ],
    },
    papers: [
      {
        id: PAPER_ID,
        title: "main.pdf",
        revisionNumber: 1,
        createdAt,
        pdfRelPath: "main.pdf",
        pdfSha256: SHA,
        pageCount: 8,
      },
    ],
    annotations: [
      {
        id: ANN_ID,
        paperId: PAPER_ID,
        category: "unclear",
        quote: "the claim that Z is always Y",
        contextBefore: "",
        contextAfter: "",
        page: 3,
        bbox: [10, 20, 30, 40] as const,
        textItemRange: { start: [4, 0] as const, end: [4, 22] as const },
        note: "",
        thread: [],
        createdAt,
      },
    ],
  };
}

describe("buildBundleV2", () => {
  it("produces a valid BundleV2 with a pdf-kind discriminated anchor", () => {
    const bundle = buildBundleV2(seed());
    expect(bundle.bundleVersion).toBe("2.0");
    expect(bundle.project.categories).toHaveLength(2);
    expect(bundle.papers).toHaveLength(1);
    const first = bundle.annotations[0];
    expect(first?.anchor.kind).toBe("pdf");
  });

  it("rejects categories not present in project.categories", () => {
    const s = seed();
    s.annotations[0] = { ...s.annotations[0], category: "not-a-slug" } as never;
    expect(() => buildBundleV2(s)).toThrow();
  });

  it("rejects paperId not present in papers[]", () => {
    const s = seed();
    s.annotations[0] = {
      ...s.annotations[0],
      paperId: "00000000-0000-4000-8000-000000000000",
    } as never;
    expect(() => buildBundleV2(s)).toThrow();
  });
});
