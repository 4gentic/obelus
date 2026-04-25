import { describe, expect, it } from "vitest";
import { PlanFile, pickLatestPlanName, pickLatestWriteupName } from "../plan";

describe("PlanFile schema", () => {
  it("accepts well-formed plan JSON", () => {
    const parsed = PlanFile.parse({
      bundleId: "sha256:abc",
      format: "typst",
      entrypoint: "main.typ",
      blocks: [
        {
          annotationId: "11111111-1111-4111-8111-111111111111",
          file: "intro.tex",
          category: "unclear",
          patch: "@@ -1 +1 @@\n-old\n+new\n",
          ambiguous: false,
          reviewerNotes: "",
        },
      ],
    });
    expect(parsed.format).toBe("typst");
    expect(parsed.entrypoint).toBe("main.typ");
    expect(parsed.blocks).toHaveLength(1);
  });

  it("accepts empty-string format and entrypoint when no descriptor was available", () => {
    const parsed = PlanFile.parse({
      bundleId: "sha256:abc",
      format: "",
      entrypoint: "",
      blocks: [],
    });
    expect(parsed.format).toBe("");
    expect(parsed.entrypoint).toBe("");
  });

  it("rejects missing fields", () => {
    expect(() =>
      PlanFile.parse({
        bundleId: "x",
        blocks: [{ annotationId: "a", file: "f" }],
      }),
    ).toThrow();
  });

  it("accepts html format", () => {
    const parsed = PlanFile.parse({
      bundleId: "sha256:abc",
      format: "html",
      entrypoint: "index.html",
      blocks: [],
    });
    expect(parsed.format).toBe("html");
  });

  it("rejects a format value outside the enum", () => {
    expect(() =>
      PlanFile.parse({
        bundleId: "sha256:abc",
        format: "docx",
        entrypoint: "main.docx",
        blocks: [],
      }),
    ).toThrow();
  });
});

describe("pickLatestPlanName", () => {
  it("picks the lexicographically greatest plan-*.json", () => {
    const picked = pickLatestPlanName([
      "plan-20260101-0000.json",
      "plan-20260419-2200.json",
      "plan-20260201-1030.json",
      "bundle-20260419.json",
    ]);
    expect(picked).toBe("plan-20260419-2200.json");
  });

  it("returns null when no plan is present", () => {
    expect(pickLatestPlanName(["bundle-x.json", "readme.md"])).toBeNull();
  });

  it("falls back to bare plan.json when no timestamped plan exists", () => {
    expect(pickLatestPlanName(["plan.json", "bundle-x.json"])).toBe("plan.json");
  });

  it("prefers timestamped plan over bare plan.json when both exist", () => {
    expect(pickLatestPlanName(["plan.json", "plan-20260423-120000.json"])).toBe(
      "plan-20260423-120000.json",
    );
  });
});

describe("pickLatestWriteupName", () => {
  it("picks the lexicographically greatest writeup-<paperId>-*.md", () => {
    const picked = pickLatestWriteupName(
      [
        "writeup-paper-1-20260101-0000.md",
        "writeup-paper-1-20260423-1430.md",
        "writeup-paper-2-20260423-1430.md",
        "plan-20260423-1430.json",
      ],
      "paper-1",
    );
    expect(picked).toBe("writeup-paper-1-20260423-1430.md");
  });

  it("falls back to bare writeup-<paperId>.md when no timestamped match", () => {
    expect(pickLatestWriteupName(["writeup-paper-1.md", "writeup-paper-2.md"], "paper-1")).toBe(
      "writeup-paper-1.md",
    );
  });

  it("never accepts a bare writeup.md (paperId is unknown)", () => {
    expect(pickLatestWriteupName(["writeup.md"], "paper-1")).toBeNull();
  });

  it("returns null when no matching writeup is present", () => {
    expect(pickLatestWriteupName(["plan-20260423-1430.json"], "paper-1")).toBeNull();
  });
});
