import { describe, expect, it } from "vitest";
import { classifyHtml } from "../classify";

describe("classifyHtml", () => {
  it("returns mode=source when the HTML carries data-src-file", () => {
    const html = '<article data-src-file="paper.md" data-src-line="1"><p>x</p></article>';
    const result = classifyHtml({ file: "paper.html", html, siblingPaths: [] });
    expect(result).toEqual({ mode: "source", sourceFile: "paper.md" });
  });

  it("falls back to a sibling .md with the same basename", () => {
    const html = "<p>hand authored</p>";
    const result = classifyHtml({
      file: "paper.html",
      html,
      siblingPaths: ["paper.html", "paper.md", "fig.png"],
    });
    expect(result).toEqual({ mode: "source", sourceFile: "paper.md" });
  });

  it("prefers .md over .tex when both siblings are present (PAIRED_SOURCE_EXTS order)", () => {
    const html = "<p>x</p>";
    const result = classifyHtml({
      file: "draft.html",
      html,
      siblingPaths: ["draft.tex", "draft.md", "draft.typ"],
    });
    expect(result).toEqual({ mode: "source", sourceFile: "draft.md" });
  });

  it("matches sibling only when in the same directory", () => {
    const html = "<p>x</p>";
    const result = classifyHtml({
      file: "papers/a/paper.html",
      html,
      siblingPaths: ["papers/a/paper.html", "papers/b/paper.md"],
    });
    expect(result).toEqual({ mode: "html" });
  });

  it("classifies as html when neither marker nor sibling is found", () => {
    const html = "<p>standalone</p>";
    const result = classifyHtml({
      file: "standalone.html",
      html,
      siblingPaths: ["standalone.html", "unrelated.md"],
    });
    expect(result).toEqual({ mode: "html" });
  });

  it("recognises a .typ sibling", () => {
    const html = "<p>x</p>";
    const result = classifyHtml({
      file: "report.html",
      html,
      siblingPaths: ["report.html", "report.typ"],
    });
    expect(result).toEqual({ mode: "source", sourceFile: "report.typ" });
  });

  it("ignores the html file itself when scanning siblings", () => {
    const html = "<p>x</p>";
    const result = classifyHtml({
      file: "paper.html",
      html,
      siblingPaths: ["paper.html"],
    });
    expect(result).toEqual({ mode: "html" });
  });
});
