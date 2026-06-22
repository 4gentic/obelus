import { describe, expect, it } from "vitest";
import {
  buildCitationIndex,
  extractCitationKeys,
  extractSections,
  isStructuredSourceFormat,
  scopeForLine,
} from "../extract";

describe("isStructuredSourceFormat", () => {
  it("accepts the three prose source formats and rejects the rest", () => {
    expect(isStructuredSourceFormat("tex")).toBe(true);
    expect(isStructuredSourceFormat("md")).toBe(true);
    expect(isStructuredSourceFormat("typ")).toBe(true);
    expect(isStructuredSourceFormat("bib")).toBe(false);
    expect(isStructuredSourceFormat("pdf")).toBe(false);
    expect(isStructuredSourceFormat("html")).toBe(false);
  });
});

describe("extractSections — LaTeX", () => {
  const tex = [
    "\\documentclass{article}",
    "\\begin{document}",
    "\\section{Introduction}", // line 3
    "Intro prose.",
    "\\subsection{Background}", // line 5
    "Background prose.",
    "\\section{Methods}", // line 7
    "Methods prose.",
    "\\end{document}", // line 9
  ].join("\n");

  it("extracts sections with 1-based inclusive ranges that nest subsections", () => {
    const sections = extractSections(tex, "tex");
    expect(sections).toEqual([
      { heading: "Introduction", level: 3, lineStart: 3, lineEnd: 6 },
      { heading: "Background", level: 4, lineStart: 5, lineEnd: 6 },
      { heading: "Methods", level: 3, lineStart: 7, lineEnd: 9 },
    ]);
  });

  it("handles starred headings and nested braces in the title", () => {
    const src = "\\section*{The $f(x)$ {edge} case}\nbody";
    const sections = extractSections(src, "tex");
    expect(sections[0]?.heading).toBe("The $f(x)$ {edge} case");
    expect(sections[0]?.level).toBe(3);
  });

  it("maps the heading hierarchy to descending levels", () => {
    const src = "\\chapter{C}\n\\section{S}\n\\subsubsection{SSS}\n\\paragraph{P}";
    expect(extractSections(src, "tex").map((s) => s.level)).toEqual([2, 3, 5, 6]);
  });
});

describe("extractSections — Typst", () => {
  const typ = [
    "= Introduction", // line 1
    "Intro prose.",
    "== Background", // line 3
    "Background prose.",
    "= Methods", // line 5
    "Methods prose.",
  ].join("\n");

  it("extracts =/== headings as levels 1/2 with nested ranges", () => {
    expect(extractSections(typ, "typ")).toEqual([
      { heading: "Introduction", level: 1, lineStart: 1, lineEnd: 4 },
      { heading: "Background", level: 2, lineStart: 3, lineEnd: 4 },
      { heading: "Methods", level: 1, lineStart: 5, lineEnd: 6 },
    ]);
  });

  it("does not treat an equals sign mid-line as a heading", () => {
    expect(extractSections("let x = 3", "typ")).toEqual([]);
  });

  it("trims surrounding whitespace from the title", () => {
    expect(extractSections("==   Spaced heading  ", "typ")[0]?.heading).toBe("Spaced heading");
  });
});

describe("extractSections — Markdown", () => {
  const md = [
    "# Title", // line 1
    "Lead.",
    "## Section A", // line 3
    "Body A.",
    "### Sub A1", // line 5
    "Body.",
    "## Section B", // line 7
    "Body B.",
  ].join("\n");

  it("extracts ATX headings with nested ranges", () => {
    expect(extractSections(md, "md")).toEqual([
      { heading: "Title", level: 1, lineStart: 1, lineEnd: 8 },
      { heading: "Section A", level: 2, lineStart: 3, lineEnd: 6 },
      { heading: "Sub A1", level: 3, lineStart: 5, lineEnd: 6 },
      { heading: "Section B", level: 2, lineStart: 7, lineEnd: 8 },
    ]);
  });

  it("ignores headings inside fenced code blocks", () => {
    const src = ["# Real", "```", "# not a heading", "```", "## Also real"].join("\n");
    expect(extractSections(src, "md").map((s) => s.heading)).toEqual(["Real", "Also real"]);
  });

  it("strips a closing ATX sequence", () => {
    expect(extractSections("## Heading ##", "md")[0]?.heading).toBe("Heading");
  });

  it("strips trailing whitespace with no closing hashes", () => {
    expect(extractSections("# Heading   ", "md")[0]?.heading).toBe("Heading");
  });

  it("does not treat a hashtag without a space as a heading", () => {
    expect(extractSections("#tag in prose", "md")).toEqual([]);
  });
});

describe("extractCitationKeys", () => {
  it("LaTeX: \\cite/\\citep/\\citet and comma lists with optional notes", () => {
    const src =
      "Per \\cite{vaswani2017} and \\citep[see][p.3]{bahdanau2014, luong2015}, also \\textcite{a}.";
    expect(extractCitationKeys(src, "tex")).toEqual([
      "vaswani2017",
      "bahdanau2014",
      "luong2015",
      "a",
    ]);
  });

  it("Markdown: bracketed and bare pandoc citations, excluding emails", () => {
    const src = "As shown [@vaswani2017; @bahdanau2014] and bare @luong2015. mail me@host.com.";
    expect(extractCitationKeys(src, "md")).toEqual(["vaswani2017", "bahdanau2014", "luong2015"]);
  });

  it("Typst: @ref and #cite(<label>) forms", () => {
    const src = 'See @vaswani2017 and #cite(<bahdanau2014>) and #cite(form: "prose", <luong2015>).';
    expect(extractCitationKeys(src, "typ")).toEqual(["vaswani2017", "bahdanau2014", "luong2015"]);
  });

  it("LaTeX: ignores non-cite commands that also carry a brace argument", () => {
    const src = "\\section{Introduction}\n\\textbf{bold} then \\cite{vaswani2017}.";
    expect(extractCitationKeys(src, "tex")).toEqual(["vaswani2017"]);
  });
});

// The extractors run over decoded paper source — untrusted input. Each rewritten
// pattern below was flagged js/polynomial-redos; a crafted line would take
// seconds-to-minutes on the old quadratic form and is near-instant now. The
// bound is generous so the guard fails on a regression, not on a slow machine.
describe("extract — ReDoS resilience on adversarial input", () => {
  const within = (budgetMs: number, run: () => void) => {
    const start = performance.now();
    run();
    expect(performance.now() - start).toBeLessThan(budgetMs);
  };

  it("Typst heading: a tab-only line after the marker terminates fast", () => {
    within(2000, () => {
      expect(extractSections(`=${"\t".repeat(100_000)}`, "typ")).toEqual([]);
    });
  });

  it("Markdown heading: a tab run after the marker terminates fast", () => {
    within(2000, () => {
      expect(extractSections(`# ${"\t".repeat(100_000)}`, "md")).toEqual([]);
    });
  });

  it("LaTeX cite: a long cite-like run with no brace list terminates fast", () => {
    within(2000, () => {
      expect(extractCitationKeys(`\\${"cite".repeat(100_000)}`, "tex")).toEqual([]);
    });
  });

  it("Typst cite: an unterminated #cite( with a tab run terminates fast", () => {
    within(2000, () => {
      expect(extractCitationKeys(`#cite(${"\t".repeat(100_000)}`, "typ")).toEqual([]);
    });
  });

  it("LaTeX cite: many unterminated \\cite[ commands stay linear (matchAll re-scan)", () => {
    within(2000, () => {
      expect(extractCitationKeys("\\cite[".repeat(50_000), "tex")).toEqual([]);
    });
  });

  it("Typst cite: many unterminated #cite( calls stay linear (matchAll re-scan)", () => {
    within(2000, () => {
      expect(extractCitationKeys("#cite(".repeat(50_000), "typ")).toEqual([]);
    });
  });

  it("citation-key punctuation strip is linear in trailing punctuation", () => {
    within(2000, () => {
      expect(extractCitationKeys(`@a${".".repeat(100_000)}`, "md")).toEqual(["a"]);
    });
  });
});

describe("buildCitationIndex", () => {
  it("deduplicates preserving first-seen order and counts references", () => {
    expect(buildCitationIndex(["a", "b", "a", "c", "a", "b"])).toEqual([
      { key: "a", count: 3 },
      { key: "b", count: 2 },
      { key: "c", count: 1 },
    ]);
  });

  it("returns an empty index for no keys", () => {
    expect(buildCitationIndex([])).toEqual([]);
  });
});

describe("scopeForLine", () => {
  const sections = [
    { heading: "Intro", level: 1, lineStart: 1, lineEnd: 4 },
    { heading: "Background", level: 2, lineStart: 3, lineEnd: 4 },
    { heading: "Methods", level: 1, lineStart: 5, lineEnd: 8 },
  ];

  it("returns the deepest enclosing section's range", () => {
    expect(scopeForLine(sections, 3)).toEqual({ scopeStart: 3, scopeEnd: 4 });
    expect(scopeForLine(sections, 6)).toEqual({ scopeStart: 5, scopeEnd: 8 });
  });

  it("returns null for a line before the first heading", () => {
    expect(scopeForLine([{ heading: "X", level: 1, lineStart: 5, lineEnd: 9 }], 2)).toBeNull();
  });
});
