import { describe, expect, it } from "vitest";
import { parseBundle } from "../parse.js";
import { BundleV1 } from "../schema.js";
import type { Bundle } from "../types.js";

const validBundle: Bundle = {
  bundleVersion: "1.0",
  tool: { name: "obelus", version: "0.1.0" },
  pdf: {
    sha256: "a".repeat(64),
    filename: "paper.pdf",
    pageCount: 12,
  },
  paper: {
    id: "550e8400-e29b-41d4-a716-446655440000",
    title: "On the Obelization of Generated Prose",
    revision: 3,
    createdAt: "2026-04-17T09:00:00.000Z",
  },
  annotations: [
    {
      id: "550e8400-e29b-41d4-a716-446655440001",
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

describe("BundleV1", () => {
  it("accepts a well-formed bundle", () => {
    expect(BundleV1.safeParse(validBundle).success).toBe(true);
  });

  it("rejects an unknown category", () => {
    const bad = structuredClone(validBundle);
    // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid for the test
    (bad.annotations[0] as any).category = "nitpick";
    expect(BundleV1.safeParse(bad).success).toBe(false);
  });

  it.each(["enhancement", "aside", "flag"] as const)("accepts the %s category", (category) => {
    const bundle = structuredClone(validBundle);
    // biome-ignore lint/suspicious/noExplicitAny: runtime-typed test fixture
    (bundle.annotations[0] as any).category = category;
    expect(BundleV1.safeParse(bundle).success).toBe(true);
  });

  it("rejects a malformed sha256", () => {
    const bad = structuredClone(validBundle);
    bad.pdf.sha256 = "abc";
    expect(BundleV1.safeParse(bad).success).toBe(false);
  });

  it("requires bundleVersion '1.0'", () => {
    const bad = structuredClone(validBundle);
    // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid for the test
    (bad as any).bundleVersion = "2.0";
    expect(BundleV1.safeParse(bad).success).toBe(false);
  });

  it("parseBundle reports a readable error path", () => {
    const bad = structuredClone(validBundle);
    // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid for the test
    (bad.annotations[0] as any).category = "nitpick";
    const result = parseBundle(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("annotations.0.category");
  });

  it("rejects a createdAt with a timezone offset", () => {
    const bad = structuredClone(validBundle);
    bad.paper.createdAt = "2026-04-17T09:00:00.000+02:00";
    expect(BundleV1.safeParse(bad).success).toBe(false);
  });
});
