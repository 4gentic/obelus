import { diffArrays } from "diff";
import { describe, expect, it } from "vitest";
import { tokenizeRich } from "./tokenize";

// A diffed run, flattened to its joined text and a single tag, for asserting on
// the shape the redline renders.
function diffTags(a: string, b: string): Array<{ tag: "add" | "del" | "ctx"; text: string }> {
  return diffArrays(tokenizeRich(a), tokenizeRich(b)).map((run) => ({
    tag: run.added ? "add" : run.removed ? "del" : "ctx",
    text: run.value.join(""),
  }));
}

describe("tokenizeRich round-trips", () => {
  const inputs = [
    "the quick brown fox jumps",
    "detecting $z_k(t)$ in the stream",
    '#text(size: 16pt, weight: "bold")',
    '$italic("goal-drift")$',
    "$$ C_k^+(t)=max(0,C_k^+(t-1)+z_k(t)-k) $$",
    "see \\cite{x} for details",
    "a lone $ with no partner",
    "a # not followed by a call",
    "leading and trailing  spaces  preserved ",
    "  ",
    "café déjà vu naïve résumé",
    "line one\nline two\n",
    "\\textbf{bold} and \\ref{fig:1} together",
    "#cite(<page-1954-cusum>) and #align(center)[X]",
    "math \\( a + b \\) then \\[ c - d \\] end",
  ];

  for (const input of inputs) {
    it(`reproduces ${JSON.stringify(input)} by joining tokens`, () => {
      expect(tokenizeRich(input).join("")).toBe(input);
    });
  }

  it("preserves an empty string", () => {
    expect(tokenizeRich("")).toEqual([]);
    expect(tokenizeRich("").join("")).toBe("");
  });
});

describe("tokenizeRich atomicity", () => {
  it("keeps inline math as exactly one token", () => {
    expect(tokenizeRich("$z_k(t)=(r_k-mu_k)/sigma_k$")).toEqual(["$z_k(t)=(r_k-mu_k)/sigma_k$"]);
  });

  it("keeps a Typst call with angle-bracket label as one token", () => {
    expect(tokenizeRich("#cite(<page-1954-cusum>)")).toEqual(["#cite(<page-1954-cusum>)"]);
  });

  it("keeps a nested Typst call with a quoted string as one token", () => {
    expect(tokenizeRich('#text(size: 16pt, weight: "bold")')).toEqual([
      '#text(size: 16pt, weight: "bold")',
    ]);
  });

  it("ignores quoted parens when balancing a math span", () => {
    expect(tokenizeRich('$italic("a)b")$')).toEqual(['$italic("a)b")$']);
  });

  it("keeps display math as one token, checked before single-dollar", () => {
    expect(tokenizeRich("$$x+y$$")).toEqual(["$$x+y$$"]);
  });

  it("keeps a LaTeX command with one argument as one token", () => {
    expect(tokenizeRich("\\textbf{bold}")).toEqual(["\\textbf{bold}"]);
  });

  it("keeps \\( ... \\) and \\[ ... \\] math as single tokens", () => {
    expect(tokenizeRich("\\(a+b\\)")).toEqual(["\\(a+b\\)"]);
    expect(tokenizeRich("\\[a-b\\]")).toEqual(["\\[a-b\\]"]);
  });
});

describe("tokenizeRich robustness", () => {
  it("treats a lone unbalanced $ as punctuation, not a span to end-of-string", () => {
    expect(tokenizeRich("cost is $ today")).toEqual(["cost", " ", "is", " ", "$", " ", "today"]);
  });

  it("does not let inline math cross a newline", () => {
    // The opening `$` has no same-line partner, so it falls back to punctuation
    // and the newline (and the paragraph after it) survive as their own tokens.
    const tokens = tokenizeRich("price $5\nnext line");
    expect(tokens.join("")).toBe("price $5\nnext line");
    expect(tokens).toContain("\n");
    expect(tokens.some((t) => t.includes("\n") && t.length > 1)).toBe(false);
  });

  it("treats a # not followed by a call as punctuation", () => {
    expect(tokenizeRich("issue #42 filed")).toEqual(["issue", " ", "#", "42", " ", "filed"]);
  });

  it("treats a bare backslash with no command name as punctuation", () => {
    expect(tokenizeRich("a \\ b").join("")).toBe("a \\ b");
  });

  it("falls back when a Typst call's group never closes", () => {
    expect(tokenizeRich("#cite(unclosed").join("")).toBe("#cite(unclosed");
  });
});

describe("diffArrays over rich tokens", () => {
  it("renders a reworded formula as one removed + one added token", () => {
    const tags = diffTags("detecting $z_k(t)=(r_k-mu_k)/sigma_k$ when", "detecting $z_k(t)$ where");
    expect(tags).toContainEqual({ tag: "del", text: "$z_k(t)=(r_k-mu_k)/sigma_k$" });
    expect(tags).toContainEqual({ tag: "add", text: "$z_k(t)$" });
    // The formula change does not bleed into the surrounding prose words.
    expect(tags).toContainEqual({ tag: "del", text: "when" });
    expect(tags).toContainEqual({ tag: "add", text: "where" });
    // No fragment of the old formula leaks into a context run.
    expect(tags.some((t) => t.tag === "ctx" && /[$]/.test(t.text))).toBe(false);
  });

  it("marks only the changed word in plain prose", () => {
    const tags = diffTags("the quick brown fox", "the slow brown fox");
    expect(tags.filter((t) => t.tag === "del")).toEqual([{ tag: "del", text: "quick" }]);
    expect(tags.filter((t) => t.tag === "add")).toEqual([{ tag: "add", text: "slow" }]);
    expect(tags.find((t) => t.tag === "ctx" && t.text.includes("brown"))).toBeDefined();
  });
});
