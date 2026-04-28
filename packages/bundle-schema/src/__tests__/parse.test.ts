import { describe, expect, it } from "vitest";
import { parseBundle } from "../parse.js";

const validBundle = {
  bundleVersion: "1.0",
  tool: { name: "obelus", version: "0.2.0" },
  project: {
    id: "00000000-0000-4000-8000-000000000001",
    label: "proj",
    kind: "writer",
    categories: [{ slug: "elaborate", label: "elaborate" }],
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
  it("dispatches a well-formed bundle to version '1.0'", () => {
    const result = parseBundle(validBundle);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.version).toBe("1.0");
  });

  it("rejects an unsupported bundleVersion with a readable error", () => {
    const result = parseBundle({ ...validBundle, bundleVersion: "9.9" });
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
