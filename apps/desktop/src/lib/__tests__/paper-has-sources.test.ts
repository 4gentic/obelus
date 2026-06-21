import type { PaperBuildRow } from "@obelus/repo";
import { describe, expect, it } from "vitest";
import { paperHasSources } from "../paper-has-sources";

function build(mainRelPath: string | null): PaperBuildRow {
  return {
    paperId: "paper-1",
    format: null,
    mainRelPath,
    mainIsPinned: false,
    compiler: null,
    compilerArgs: [],
    outputRelDir: null,
    scannedAt: null,
    updatedAt: "2026-01-01T00:00:00",
  };
}

describe("paperHasSources", () => {
  it("is true for a non-empty mainRelPath", () => {
    expect(paperHasSources(build("main.tex"))).toBe(true);
  });

  it("is false for an empty mainRelPath", () => {
    expect(paperHasSources(build(""))).toBe(false);
  });

  it("is false for a null mainRelPath", () => {
    expect(paperHasSources(build(null))).toBe(false);
  });

  it("is false for a null build", () => {
    expect(paperHasSources(null)).toBe(false);
  });

  it("is false for an undefined build", () => {
    expect(paperHasSources(undefined)).toBe(false);
  });
});
