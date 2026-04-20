import { describe, expect, it } from "vitest";
import { buildBundleV1, suggestBundleFilename } from "../index";

const SHA = "a".repeat(64);

function seed() {
  const paperId = "11111111-1111-4111-8111-111111111111";
  const revisionId = "22222222-2222-4222-8222-222222222222";
  const createdAt = "2026-04-19T12:00:00.000Z";
  return {
    paper: { id: paperId, title: "Test" },
    revision: {
      id: revisionId,
      paperId,
      revisionNumber: 1,
      pdfSha256: SHA,
      createdAt,
    },
    pdf: { filename: "paper.pdf", pageCount: 12 },
    annotations: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        category: "unclear" as const,
        quote: "The results were good.",
        contextBefore: "prior text ",
        contextAfter: " next text",
        page: 3,
        bbox: [10, 20, 30, 40] as const,
        textItemRange: { start: [4, 0] as const, end: [4, 22] as const },
        note: "How good?",
        thread: [],
        createdAt,
      },
    ],
  };
}

describe("buildBundleV1", () => {
  it("produces a bundle that parses against BundleV1", () => {
    const bundle = buildBundleV1(seed());
    expect(bundle.annotations).toHaveLength(1);
    expect(bundle.pdf.filename).toBe("paper.pdf");
    expect(bundle.paper.title).toBe("Test");
    expect(bundle.bundleVersion).toBe("1.0");
  });

  it("throws when revision.paperId != paper.id", () => {
    const s = seed();
    expect(() =>
      buildBundleV1({
        ...s,
        revision: { ...s.revision, paperId: "deadbeef-dead-4dea-8dea-deaddeaddead" },
      }),
    ).toThrow();
  });

  it("omits groupId when absent", () => {
    const bundle = buildBundleV1(seed());
    expect(bundle.annotations[0]).not.toHaveProperty("groupId");
  });

  it("preserves groupId when present", () => {
    const s = seed();
    const groupId = "44444444-4444-4444-8444-444444444444";
    const base = s.annotations[0];
    if (!base) throw new Error("seed missing annotation");
    const withGroup = { ...s, annotations: [{ ...base, groupId }] };
    const bundle = buildBundleV1(withGroup);
    expect(bundle.annotations[0]?.groupId).toBe(groupId);
  });
});

describe("suggestBundleFilename", () => {
  it("formats review kind as obelus-review-YYYY-MM-DD.json", () => {
    const name = suggestBundleFilename("review", new Date("2026-04-17T09:03:00"));
    expect(name).toBe("obelus-review-2026-04-17.json");
  });

  it("formats revise kind as obelus-revise-YYYY-MM-DD.json", () => {
    const name = suggestBundleFilename("revise", new Date("2026-04-17T09:03:00"));
    expect(name).toBe("obelus-revise-2026-04-17.json");
  });
});
