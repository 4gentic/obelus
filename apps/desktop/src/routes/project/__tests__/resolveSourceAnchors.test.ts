import { describe, expect, it } from "vitest";
import { resolveAnnotationSpan } from "../resolveSourceAnchors";

describe("resolveAnnotationSpan", () => {
  it("resolves a unique quote with full context", () => {
    const source = [
      "\\section{Introduction}",
      "The attention operator of Vaswani et al. introduced",
      "dot-product attention in 2017.",
      "",
      "\\section{Method}",
    ].join("\n");

    const result = resolveAnnotationSpan("paper.tex", source, {
      quote: "attention operator of Vaswani et al.",
      contextBefore: "The ",
      contextAfter: " introduced",
    });

    expect(result.kind).toBe("resolved");
    expect(result.span).toEqual({
      file: "paper.tex",
      lineStart: 2,
      colStart: 4,
      lineEnd: 2,
      colEnd: 40,
    });
  });

  it("folds the fi ligature and matches across a PDF-style hyphenated break", () => {
    const source = ["The classifier uses a fixed threshold", "for detection."].join("\n");

    // PDF extraction often produces the `ﬁ` ligature inside the quote while
    // the LaTeX source has plain `fi`.
    const result = resolveAnnotationSpan("paper.tex", source, {
      quote: "classi\u{FB01}er uses a \u{FB01}xed threshold",
      contextBefore: "The ",
      contextAfter: "\nfor",
    });

    expect(result.kind).toBe("resolved");
    expect(result.span?.lineStart).toBe(1);
    expect(result.span?.lineEnd).toBe(1);
  });

  it("falls back to quote + nearby context when the full run fails", () => {
    // Real papers rarely have the context run match literally — e.g. the PDF
    // squeezed a table figure into the middle, so contextAfter doesn't line
    // up. The resolver should still succeed on a unique quote.
    const source = [
      "Section 3 introduces the main result.",
      "",
      "Our algorithm runs in O(n log n) amortized time",
      "as shown in Theorem 2.",
    ].join("\n");

    const result = resolveAnnotationSpan("paper.tex", source, {
      quote: "O(n log n) amortized time",
      contextBefore: "algorithm runs in ",
      // This context won't literally appear — rendered PDF inserted a table
      // between the quote and the next sentence.
      contextAfter: " [Table 4 omitted]",
    });

    expect(result.kind).toBe("resolved");
    expect(result.span?.lineStart).toBe(3);
  });

  it("marks ambiguous when the quote occurs multiple times with no disambiguating context", () => {
    const source = ["The result is significant.", "", "The result is significant."].join("\n");

    const result = resolveAnnotationSpan("paper.md", source, {
      quote: "result is significant",
      contextBefore: "",
      contextAfter: "",
    });

    expect(result.kind).toBe("ambiguous");
  });

  it("marks ambiguous when the quote is absent from the source", () => {
    const source = "nothing to match here.\n";

    const result = resolveAnnotationSpan("paper.tex", source, {
      quote: "a phrase that is not in the source",
      contextBefore: "",
      contextAfter: "",
    });

    expect(result.kind).toBe("ambiguous");
  });

  it("collapses repeated whitespace so source line-wrapping does not break the match", () => {
    // Source has a soft wrap inside the quoted phrase; the PDF extraction
    // produced a single-spaced run.
    const source = [
      "The proposed estimator is unbiased",
      "      under the Gaussian assumption,",
      "and strictly consistent.",
    ].join("\n");

    const result = resolveAnnotationSpan("paper.tex", source, {
      quote: "proposed estimator is unbiased under the Gaussian assumption",
      contextBefore: "The ",
      contextAfter: ", and",
    });

    expect(result.kind).toBe("resolved");
    expect(result.span?.lineStart).toBe(1);
    expect(result.span?.lineEnd).toBe(2);
  });
});
