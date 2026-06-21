import { diffArrays } from "diff";
import { describe, expect, it } from "vitest";
import { isHeavyRewrite, looksLikeCode } from "./classify";
import { tokenizeRich } from "./tokenize";

describe("looksLikeCode", () => {
  it("treats a Typst preamble as code", () => {
    const before = "#set document(title: [Paper])\n#set page(margin: 2cm)\n#align(center)[Title]";
    const after = "#set document(title: [Revised])\n#set page(margin: 3cm)\n#align(center)[Title]";
    expect(looksLikeCode(before, after)).toBe(true);
  });

  it("treats a LaTeX preamble as code", () => {
    const before = "\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}";
    const after =
      "\\documentclass{report}\n\\usepackage{amsmath}\n\\usepackage{graphicx}\n\\begin{document}";
    expect(looksLikeCode(before, after)).toBe(true);
  });

  it("treats a full-sentence prose paragraph as prose", () => {
    const before =
      "The experiment measured reaction times across three conditions, and the results were clear.";
    const after =
      "The experiment measured reaction times across four conditions, and the results were striking.";
    expect(looksLikeCode(before, after)).toBe(false);
  });

  it("treats a Markdown heading and body as prose", () => {
    const before = "# Introduction\n\nWe study the effect of sleep on memory consolidation.";
    const after =
      "# Introduction\n\nWe study the effect of sleep deprivation on memory consolidation.";
    expect(looksLikeCode(before, after)).toBe(false);
  });

  it("treats a single config-style attribute line as code", () => {
    expect(looksLikeCode("size: 10pt", "size: 11pt")).toBe(true);
  });

  it("treats mostly-prose with one inline command as prose", () => {
    const before = "This builds on prior work \\cite{smith2020} in the same vein.";
    const after = "This extends prior work \\cite{smith2020} in a new direction entirely.";
    expect(looksLikeCode(before, after)).toBe(false);
  });

  it("is false for an all-empty change", () => {
    expect(looksLikeCode("", "")).toBe(false);
  });

  it("ignores blank lines when scoring", () => {
    const before = "#set page(margin: 2cm)\n\n#align(center)[X]";
    const after = "#set page(margin: 3cm)\n\n#align(center)[X]";
    expect(looksLikeCode(before, after)).toBe(true);
  });

  it("reads a key=value attribute as code", () => {
    expect(looksLikeCode("width=0.8", "width=0.9")).toBe(true);
  });

  it("does not mistake a sentence containing a colon for config", () => {
    const before = "Note: the sample was small, so we treat the result with caution.";
    const after = "Note: the sample was tiny, so we treat the result with great caution.";
    expect(looksLikeCode(before, after)).toBe(false);
  });
});

describe("isHeavyRewrite", () => {
  const runs = (before: string, after: string) =>
    diffArrays(tokenizeRich(before), tokenizeRich(after));

  const PASSAGE =
    "On each flagged category the detector keeps a running baseline of the amendment rate and the escalation rate, then raises a warning only when the observed value drifts far enough from that baseline to exceed a fixed threshold.";

  it("is true when most of a long passage changed", () => {
    const after =
      "Whenever a category trips the guard, the monitor instead compares the live signal against an adaptive reference that it recalibrates continuously, and it escalates the moment the accumulated deviation crosses a learned boundary.";
    expect(isHeavyRewrite(runs(PASSAGE, after))).toBe(true);
  });

  it("is false for a one-word edit in a long passage", () => {
    const after = PASSAGE.replace("fixed threshold", "learned threshold");
    expect(isHeavyRewrite(runs(PASSAGE, after))).toBe(false);
  });

  it("is false for a fully rewritten but short passage", () => {
    expect(isHeavyRewrite(runs("the cat sat on the mat", "a dog ran through the yard"))).toBe(
      false,
    );
  });

  it("is false for an empty change", () => {
    expect(isHeavyRewrite(runs("", ""))).toBe(false);
  });
});
