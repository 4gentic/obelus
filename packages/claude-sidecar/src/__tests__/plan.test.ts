import { describe, expect, it } from "vitest";
import { PlanFile, pickLatestPlanName } from "../plan";

describe("PlanFile schema", () => {
  it("accepts well-formed plan JSON", () => {
    const parsed = PlanFile.parse({
      bundleId: "sha256:abc",
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
    expect(parsed.blocks).toHaveLength(1);
  });

  it("rejects missing fields", () => {
    expect(() =>
      PlanFile.parse({
        bundleId: "x",
        blocks: [{ annotationId: "a", file: "f" }],
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
});
