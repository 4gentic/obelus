import { describe, expect, it } from "vitest";
import { artifactLabel } from "../artifact-label";

describe("artifactLabel", () => {
  it("prettifies a stamped review bundle", () => {
    expect(artifactLabel("bundle-20260426-105649.json")).toBe("the review bundle (10:56)");
  });

  it("prettifies a stamped plan", () => {
    expect(artifactLabel("plan-20260426-032015.json")).toBe("the plan (03:20)");
  });

  it("prettifies the human-readable plan markdown companion", () => {
    expect(artifactLabel("plan-20260426-105649.md")).toBe("the plan (10:56)");
  });

  it("recognises a bare plan.json", () => {
    expect(artifactLabel("plan.json")).toBe("the plan");
  });

  it("prettifies a stamped writeup with paperId", () => {
    expect(artifactLabel("writeup-paper-1-20260426-143022.md")).toBe("the write-up (14:30)");
  });

  it("recognises a bare writeup-<paperId>.md", () => {
    expect(artifactLabel("writeup-paper-1.md")).toBe("the write-up");
  });

  it("prettifies a stamped rubric", () => {
    expect(artifactLabel("rubric-20260426-090000.json")).toBe("the rubric (09:00)");
  });

  it("strips the directory prefix before matching", () => {
    expect(
      artifactLabel(
        "/Users/x/Library/Application Support/app/projects/p/bundle-20260426-105649.json",
      ),
    ).toBe("the review bundle (10:56)");
  });

  it("falls through to the basename for user-meaningful filenames", () => {
    expect(artifactLabel("paper.tex")).toBe("paper.tex");
    expect(artifactLabel("/abs/path/main.typ")).toBe("main.typ");
    expect(artifactLabel("references.bib")).toBe("references.bib");
  });

  it("does not match a near-miss (wrong extension or shape)", () => {
    expect(artifactLabel("plan-20260426.json")).toBe("plan-20260426.json");
    expect(artifactLabel("bundle.json")).toBe("bundle.json");
    expect(artifactLabel("writeup.md")).toBe("writeup.md");
  });

  it("returns the empty string unchanged", () => {
    expect(artifactLabel("")).toBe("");
  });
});
