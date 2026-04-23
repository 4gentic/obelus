import { describe, expect, it } from "vitest";
import { resolveAcrossFiles, resolveAnnotationSpan } from "../resolveSourceAnchors";

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

  it("folds PDF line-break hyphenation (irre- versible → irreversible)", () => {
    const source = "Cache invalidation is irreversible, say the authors.";
    const result = resolveAnnotationSpan("paper.tex", source, {
      // PDF text extraction frequently surfaces line-break hyphenation as a
      // literal `- ` sequence inside the quote even though the source has
      // the word joined.
      quote: "Cache invalidation is irre- versible",
      contextBefore: "",
      contextAfter: ", say the authors.",
    });
    expect(result.kind).toBe("resolved");
    expect(result.span?.lineStart).toBe(1);
  });
});

describe("normalizeWithMap markup stripping", () => {
  it("folds Typst italic (`_phrase_`) so the PDF quote matches", () => {
    const source = "We introduce _Negotiated Autonomy_, a protocol.";
    const result = resolveAnnotationSpan("paper.typ", source, {
      quote: "We introduce Negotiated Autonomy, a protocol.",
      contextBefore: "",
      contextAfter: "",
    });
    expect(result.kind).toBe("resolved");
    expect(result.span?.lineStart).toBe(1);
  });

  it("folds Typst bold (`*phrase*`) so the PDF quote matches", () => {
    const source = "This is *the* result.";
    const result = resolveAnnotationSpan("paper.typ", source, {
      quote: "This is the result.",
      contextBefore: "",
      contextAfter: "",
    });
    expect(result.kind).toBe("resolved");
    expect(result.span?.lineStart).toBe(1);
  });

  it("leaves snake_case identifiers untouched (no emphasis folding inside a word)", () => {
    const source = "Set the flag snake_case_var to true.";
    const result = resolveAnnotationSpan("paper.typ", source, {
      quote: "Set the flag snake_case_var to true.",
      contextBefore: "",
      contextAfter: "",
    });
    expect(result.kind).toBe("resolved");
    expect(result.span?.lineStart).toBe(1);
  });

  it("does not fold an emphasis opener that spans a newline (stray underscore)", () => {
    // An opening `_` with no closer on the same line must NOT swallow content.
    // Otherwise a single stray underscore would silently erase the rest of
    // the paragraph.
    const source = ["A stray _underscore in prose", "lingers harmlessly."].join("\n");
    const result = resolveAnnotationSpan("paper.typ", source, {
      // The quote keeps the underscore; normalization preserves it too.
      quote: "A stray _underscore in prose lingers harmlessly.",
      contextBefore: "",
      contextAfter: "",
    });
    expect(result.kind).toBe("resolved");
    expect(result.span?.lineStart).toBe(1);
  });

  it("folds LaTeX \\emph{...} so the PDF quote matches", () => {
    const source = "We introduce \\emph{Negotiated Autonomy}, a protocol.";
    const result = resolveAnnotationSpan("paper.tex", source, {
      quote: "We introduce Negotiated Autonomy, a protocol.",
      contextBefore: "",
      contextAfter: "",
    });
    expect(result.kind).toBe("resolved");
    expect(result.span?.lineStart).toBe(1);
  });

  it("folds LaTeX \\textbf{...} and \\textit{...}", () => {
    const source = "Result \\textbf{A} dominates \\textit{B}.";
    const result = resolveAnnotationSpan("paper.tex", source, {
      quote: "Result A dominates B.",
      contextBefore: "",
      contextAfter: "",
    });
    expect(result.kind).toBe("resolved");
    expect(result.span?.lineStart).toBe(1);
  });

  it("drops LaTeX \\cite{...} entirely (PDF renders only a numeral)", () => {
    const source = "as shown by Vaswani et al.\\cite{vaswani2017}.";
    const result = resolveAnnotationSpan("paper.tex", source, {
      quote: "as shown by Vaswani et al..",
      contextBefore: "",
      contextAfter: "",
    });
    expect(result.kind).toBe("resolved");
    expect(result.span?.lineStart).toBe(1);
  });

  it("drops Typst #cite(<key>) entirely", () => {
    const source = "shown by Vaswani et al.#cite(<vaswani-2017>).";
    const result = resolveAnnotationSpan("paper.typ", source, {
      quote: "shown by Vaswani et al..",
      contextBefore: "",
      contextAfter: "",
    });
    expect(result.kind).toBe("resolved");
    expect(result.span?.lineStart).toBe(1);
  });

  it("drops Typst #v(...) and #h(...) spacing calls", () => {
    const source = "First paragraph.#v(0.5em) Second paragraph begins here.";
    const result = resolveAnnotationSpan("paper.typ", source, {
      quote: "First paragraph. Second paragraph begins here.",
      contextBefore: "",
      contextAfter: "",
    });
    expect(result.kind).toBe("resolved");
    expect(result.span?.lineStart).toBe(1);
  });

  it("drops Typst #set and #show directives to end of line", () => {
    const source = ["#set par(justify: true)", "Agentic systems face a trilemma."].join("\n");
    const result = resolveAnnotationSpan("paper.typ", source, {
      quote: "Agentic systems face a trilemma.",
      contextBefore: "",
      contextAfter: "",
    });
    expect(result.kind).toBe("resolved");
    expect(result.span?.lineStart).toBe(2);
  });

  it("strips #par[ chrome while keeping the inner prose as the anchor", () => {
    const source = ["#par[", "  Agentic systems face a trilemma.", "]"].join("\n");
    const result = resolveAnnotationSpan("paper.typ", source, {
      quote: "Agentic systems face a trilemma.",
      contextBefore: "",
      contextAfter: "",
    });
    expect(result.kind).toBe("resolved");
    expect(result.span?.lineStart).toBe(2);
  });

  it("strips #align(center)[...] chrome while keeping inner prose", () => {
    const source = ["#align(center)[", '  #text(weight: "bold")[Abstract]', "]"].join("\n");
    const result = resolveAnnotationSpan("paper.typ", source, {
      // The #text(...)[Abstract] still leaves the Abstract body reachable via
      // the `[` body-enter rule? We don't special-case `#text`, so the word
      // "Abstract" is wrapped in residual chrome. Use a more realistic quote
      // — the outer #align opens a body that ultimately contains "Abstract".
      quote: "Abstract",
      contextBefore: "",
      contextAfter: "",
    });
    // The residual `#text(weight: "bold")[Abstract]` still contains the
    // string "abstract" verbatim inside the bracketed body, so indexOf finds
    // it. The point of this test is that #align's chrome didn't corrupt the
    // surrounding prose.
    expect(result.kind).toBe("resolved");
  });

  it("folds markup inside a #par[...] wrapper (emphasis nested in a block)", () => {
    const source = ["#par[", "  We introduce _Negotiated Autonomy_, a protocol.", "]"].join("\n");
    const result = resolveAnnotationSpan("paper.typ", source, {
      quote: "We introduce Negotiated Autonomy, a protocol.",
      contextBefore: "",
      contextAfter: "",
    });
    expect(result.kind).toBe("resolved");
    expect(result.span?.lineStart).toBe(2);
  });

  it("folds Typst `---` / `--` dash runs to match PDF em/en-dashes", () => {
    const source = "Three loops --- fast (5--99 cases) --- end.";
    const result = resolveAnnotationSpan("paper.typ", source, {
      // PDF text layer surfaces `---` as U+2014 and `--` as U+2013.
      quote: "Three loops — fast (5–99 cases) — end.",
      contextBefore: "",
      contextAfter: "",
    });
    expect(result.kind).toBe("resolved");
    expect(result.span?.lineStart).toBe(1);
  });

  it("emits `colEnd` at the end of a collapsed dash run, not inside it", () => {
    // The normalizer collapses `---` → `-`; when the match terminates on that
    // run, the emitted span must cover the whole run in source coordinates.
    // Previously the endpoint was the start of the run + 1, truncating mid-run.
    const source = "Three loops --- fast.";
    const result = resolveAnnotationSpan("paper.typ", source, {
      quote: "Three loops —",
      contextBefore: "",
      contextAfter: "",
    });
    expect(result.kind).toBe("resolved");
    expect(result.span?.colStart).toBe(0);
    expect(result.span?.colEnd).toBe(15);
  });

  it("keeps `state-of-the-art` intact (single-dash compounds are not collapsed)", () => {
    const source = "This is a state-of-the-art result.";
    const result = resolveAnnotationSpan("paper.typ", source, {
      quote: "This is a state-of-the-art result.",
      contextBefore: "",
      contextAfter: "",
    });
    expect(result.kind).toBe("resolved");
  });

  it("folds smart quotes so `agent's` in source matches `agent’s` in PDF", () => {
    const source = "The agent's self-assessment matters.";
    const result = resolveAnnotationSpan("paper.typ", source, {
      quote: "The agent’s self-assessment matters.",
      contextBefore: "",
      contextAfter: "",
    });
    expect(result.kind).toBe("resolved");
  });

  it("strips Typst inline math `$...$` and folds `<=` against `≤`", () => {
    const source = "The calibration gap is $<= 7 %$ on clean cases.";
    const result = resolveAnnotationSpan("paper.typ", source, {
      quote: "The calibration gap is <= 7 % on clean cases.",
      contextBefore: "",
      contextAfter: "",
    });
    expect(result.kind).toBe("resolved");
  });

  it("resolves the real negotiated_autonomy abstract rephrase through Typst markup", () => {
    // Shape of the failing annotation: the PDF quote has `Negotiated
    // Autonomy` (no markup) but the Typst source wraps it in `_..._`, and
    // there's another `_Trust Contract_` further in. Without markup
    // stripping, indexOf diverges at the first underscored phrase.
    const source = [
      "#par[",
      "  We introduce _Negotiated Autonomy_, a protocol in which an agent",
      "  and a principal collaboratively define, execute, and evolve a",
      "  machine-readable _Trust Contract_.",
      "]",
    ].join("\n");
    const result = resolveAnnotationSpan("paper/short/00-abstract.typ", source, {
      quote:
        "We introduce Negotiated Autonomy, a protocol in which an agent and a principal collaboratively define, execute, and evolve a machine-readable Trust Contract.",
      contextBefore: "",
      contextAfter: "",
    });
    expect(result.kind).toBe("resolved");
    expect(result.span?.lineStart).toBe(2);
    expect(result.span?.lineEnd).toBe(4);
  });
});

describe("resolveAcrossFiles", () => {
  it("resolves a unique quote even when context lives in a different sibling", () => {
    // Shape of the real negotiated_autonomy failure: the PDF quote sits in
    // 01-introduction.typ, but contextBefore is the trailing characters of
    // the abstract (in 00-abstract.typ). The single-file resolver refused
    // this (context missed the ±400 window inside the introduction file);
    // the multi-file resolver accepts it because the quote is globally
    // unique across candidates.
    const abstract = [
      "#par[",
      "  The abstract lays out the trilemma and introduces the protocol.",
      "]",
    ].join("\n");
    const intro = [
      "= Introduction",
      "",
      "Agentic AI systems are being deployed in settings where a single wrong action",
      "has irreversible consequences: lease negotiations, clinical-trial enrolment,",
      "mental-health triage, financial execution. In such settings, every organisation",
    ].join("\n");

    const result = resolveAcrossFiles(
      [
        { relPath: "paper/short/00-abstract.typ", text: abstract },
        { relPath: "paper/short/01-introduction.typ", text: intro },
      ],
      {
        quote:
          "lease negotiations, clinical-trial enrolment, mental-health triage, financial execution",
        contextBefore: "s where a single wrong action has irreversible consequences:",
        contextAfter: ". In such settings, every organisation",
      },
    );

    expect(result.kind).toBe("resolved");
    expect(result.span?.file).toBe("paper/short/01-introduction.typ");
    expect(result.span?.lineStart).toBe(4);
    expect(result.span?.lineEnd).toBe(5);
  });

  it("uses context proximity to disambiguate multi-hit quotes", () => {
    const a = [
      "In section A we use the phrase 'shared motif' for the first time.",
      "Anchor-before-A text.",
    ].join("\n");
    const b = [
      "Later the discussion revisits the phrase 'shared motif' in a fresh frame.",
      "Anchor-before-B text that is clearly different.",
    ].join("\n");

    const result = resolveAcrossFiles(
      [
        { relPath: "a.md", text: a },
        { relPath: "b.md", text: b },
      ],
      {
        quote: "shared motif",
        contextBefore: "the discussion revisits the phrase",
        contextAfter: "in a fresh frame.",
      },
    );

    expect(result.kind).toBe("resolved");
    expect(result.span?.file).toBe("b.md");
  });

  it("is ambiguous when a quote appears in multiple files and context doesn't disambiguate", () => {
    const a = "The phrase X Y Z appears here.";
    const b = "Elsewhere: X Y Z appears again.";

    const result = resolveAcrossFiles(
      [
        { relPath: "a.md", text: a },
        { relPath: "b.md", text: b },
      ],
      { quote: "X Y Z", contextBefore: "", contextAfter: "" },
    );

    expect(result.kind).toBe("ambiguous");
  });

  it("returns ambiguous when the quote appears nowhere", () => {
    const result = resolveAcrossFiles(
      [
        { relPath: "a.md", text: "alpha beta gamma" },
        { relPath: "b.md", text: "delta epsilon zeta" },
      ],
      { quote: "completely unrelated", contextBefore: "", contextAfter: "" },
    );
    expect(result.kind).toBe("ambiguous");
  });
});
