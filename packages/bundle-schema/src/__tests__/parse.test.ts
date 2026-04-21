import { describe, expect, it } from "vitest";
import { parseBundle } from "../parse.js";

const v1Bundle = {
  bundleVersion: "1.0",
  tool: { name: "obelus", version: "0.1.0" },
  pdf: { sha256: "b".repeat(64), filename: "paper.pdf", pageCount: 4 },
  paper: {
    id: "550e8400-e29b-41d4-a716-446655440000",
    title: "Paper",
    revision: 1,
    createdAt: "2026-04-17T09:00:00.000Z",
  },
  annotations: [],
};

const v2Bundle = {
  bundleVersion: "2.0",
  tool: { name: "obelus", version: "0.2.0" },
  project: {
    id: "00000000-0000-4000-8000-000000000001",
    label: "proj",
    kind: "writer",
    categories: [{ slug: "unclear", label: "unclear" }],
  },
  papers: [
    {
      id: "00000000-0000-4000-8000-000000000010",
      title: "Paper",
      revision: 1,
      createdAt: "2026-04-17T09:00:00.000Z",
      entrypoint: "main.tex",
    },
  ],
  annotations: [],
};

describe("parseBundle dispatch", () => {
  it("dispatches a v1 bundle to version '1.0'", () => {
    const result = parseBundle(v1Bundle);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.version).toBe("1.0");
  });

  it("dispatches a v2 bundle to version '2.0'", () => {
    const result = parseBundle(v2Bundle);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.version).toBe("2.0");
  });

  it("rejects an unsupported bundleVersion with a readable error", () => {
    const result = parseBundle({ ...v1Bundle, bundleVersion: "9.9" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("unsupported");
  });

  it("rejects input without bundleVersion", () => {
    const result = parseBundle({ tool: { name: "obelus" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("missing bundleVersion");
  });

  it("rejects non-object input", () => {
    expect(parseBundle(null).ok).toBe(false);
    expect(parseBundle("not-a-bundle").ok).toBe(false);
  });
});
