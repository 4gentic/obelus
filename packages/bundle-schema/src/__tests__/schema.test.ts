import { describe, expect, it } from "vitest";
import { parseBundle } from "../parse.js";
import { Bundle } from "../schema.js";

const validBundle: Bundle = {
  bundleVersion: "1.0",
  tool: { name: "obelus", version: "0.2.0" },
  project: {
    id: "00000000-0000-4000-8000-000000000001",
    label: "attention-survey",
    kind: "writer",
    categories: [
      { slug: "unclear", label: "unclear" },
      { slug: "wrong", label: "wrong", color: "#B84A2E" },
      { slug: "praise", label: "praise" },
    ],
  },
  papers: [
    {
      id: "00000000-0000-4000-8000-000000000010",
      title: "On the Scalability of Transformer Attention",
      revision: 1,
      createdAt: "2026-04-15T10:00:00.000Z",
      pdf: {
        relPath: "papers/attention.pdf",
        sha256: "a".repeat(64),
        pageCount: 12,
      },
      entrypoint: "main.tex",
    },
    {
      id: "00000000-0000-4000-8000-000000000011",
      title: "Notes on low-rank approximations",
      revision: 1,
      createdAt: "2026-04-16T10:00:00.000Z",
      entrypoint: "notes/intro.tex",
    },
  ],
  annotations: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      paperId: "00000000-0000-4000-8000-000000000010",
      category: "unclear",
      quote: "attention is a bottleneck",
      contextBefore: "We argue that ",
      contextAfter: " for sequences past 16k tokens.",
      anchor: {
        kind: "pdf",
        page: 1,
        bbox: [72, 520, 420, 536],
        textItemRange: { start: [42, 0], end: [42, 26] },
      },
      note: "define 'bottleneck' in what regime",
      thread: [],
      createdAt: "2026-04-17T09:00:00.000Z",
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      paperId: "00000000-0000-4000-8000-000000000011",
      category: "wrong",
      quote: "linear attention is equivalent to softmax attention",
      contextBefore: "It is commonly claimed that ",
      contextAfter: ", but this ignores the normalization.",
      anchor: {
        kind: "source",
        file: "notes/intro.tex",
        lineStart: 14,
        colStart: 0,
        lineEnd: 14,
        colEnd: 53,
      },
      note: "this claim is too strong",
      thread: [],
      createdAt: "2026-04-17T09:05:00.000Z",
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      paperId: "00000000-0000-4000-8000-000000000011",
      category: "praise",
      quote: "Attention is a bottleneck, but not a uniform one.",
      contextBefore: "We conclude with: ",
      contextAfter: " The right mitigation depends on the task.",
      anchor: {
        kind: "html",
        file: "notes/preview.html",
        xpath: "/html/body/section[1]/p[3]",
        charOffsetStart: 0,
        charOffsetEnd: 49,
        sourceHint: {
          kind: "source",
          file: "notes/intro.tex",
          lineStart: 42,
          colStart: 0,
          lineEnd: 42,
          colEnd: 49,
        },
      },
      note: "keep as the opening of the conclusion",
      thread: [],
      createdAt: "2026-04-17T09:10:00.000Z",
    },
  ],
};

describe("Bundle", () => {
  it("accepts a well-formed bundle", () => {
    expect(Bundle.safeParse(validBundle).success).toBe(true);
  });

  it("rejects an annotation whose paperId has no matching paper", () => {
    const bad = structuredClone(validBundle);
    // biome-ignore lint/suspicious/noExplicitAny: deliberately mutating for the test
    (bad.annotations[0] as any).paperId = "99999999-9999-4999-8999-999999999999";
    const result = parseBundle(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("annotations.0.paperId");
  });

  it("rejects an annotation whose category is not in project.categories", () => {
    const bad = structuredClone(validBundle);
    // biome-ignore lint/suspicious/noExplicitAny: deliberately mutating for the test
    (bad.annotations[1] as any).category = "nitpick";
    const result = parseBundle(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("annotations.1.category");
  });

  it("rejects a pdf anchor missing textItemRange", () => {
    const bad = structuredClone(validBundle);
    // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid for the test
    const anchor = (bad.annotations[0] as any).anchor as Record<string, unknown>;
    anchor.textItemRange = undefined;
    expect(Bundle.safeParse(bad).success).toBe(false);
  });

  it("rejects a malformed category slug in project.categories", () => {
    const bad = structuredClone(validBundle);
    // biome-ignore lint/suspicious/noExplicitAny: deliberately mutating for the test
    (bad.project.categories[0] as any).slug = "Bad Slug";
    expect(Bundle.safeParse(bad).success).toBe(false);
  });

  it("requires bundleVersion '1.0'", () => {
    const bad = structuredClone(validBundle);
    // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid for the test
    (bad as any).bundleVersion = "2.0";
    expect(Bundle.safeParse(bad).success).toBe(false);
  });

  it("rejects an absolute POSIX path in SourceAnchor.file", () => {
    const bad = structuredClone(validBundle);
    // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid for the test
    (bad.annotations[1] as any).anchor.file = "/etc/passwd";
    expect(Bundle.safeParse(bad).success).toBe(false);
  });

  it("rejects a Windows drive-absolute path in HtmlAnchor.file", () => {
    const bad = structuredClone(validBundle);
    // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid for the test
    (bad.annotations[2] as any).anchor.file = "C:\\secret.html";
    expect(Bundle.safeParse(bad).success).toBe(false);
  });

  it("rejects a `..` segment in paper.pdf.relPath", () => {
    const bad = structuredClone(validBundle);
    // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid for the test
    (bad.papers[0] as any).pdf.relPath = "../../etc/passwd";
    expect(Bundle.safeParse(bad).success).toBe(false);
  });

  it("rejects backslash separators in paper.pdf.relPath", () => {
    const bad = structuredClone(validBundle);
    // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid for the test
    (bad.papers[0] as any).pdf.relPath = "papers\\attention.pdf";
    expect(Bundle.safeParse(bad).success).toBe(false);
  });

  it("rejects a createdAt with a timezone offset", () => {
    const bad = structuredClone(validBundle);
    // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid for the test
    (bad.annotations[0] as any).createdAt = "2026-04-17T09:00:00.000+02:00";
    expect(Bundle.safeParse(bad).success).toBe(false);
  });

  it("accepts an html-element anchor with no char offsets", () => {
    const ok = structuredClone(validBundle);
    // biome-ignore lint/suspicious/noExplicitAny: deliberately replacing for the test
    (ok.annotations[2] as any).anchor = {
      kind: "html-element",
      file: "diagram.html",
      xpath: "./figure[1]/img[1]",
    };
    expect(Bundle.safeParse(ok).success).toBe(true);
  });

  it("rejects an html-element anchor that smuggles char offsets", () => {
    const bad = structuredClone(validBundle);
    // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid for the test
    (bad.annotations[2] as any).anchor = {
      kind: "html-element",
      file: "diagram.html",
      xpath: "./img[1]",
      charOffsetStart: 0,
      charOffsetEnd: 5,
    };
    // strict() isn't applied at this level — z.object accepts unknown keys —
    // so the assertion is the inverse: the bundle still parses (extra keys
    // ignored). Codify this so future schema tightening flips the assertion.
    expect(Bundle.safeParse(bad).success).toBe(true);
  });
});
