import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../markdown.js";

describe("renderMarkdown", () => {
  it("emits data-src attributes on a heading + paragraph", () => {
    const result = renderMarkdown({
      file: "intro.md",
      text: "# Hello\n\nA paragraph.\n",
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.html).toContain('data-src-file="intro.md"');
    expect(result.html).toContain('data-src-line="1"');
    expect(result.html).toContain('data-src-line="3"');
    expect(result.html).toMatch(/<h1[^>]*>Hello<\/h1>/);
    expect(result.html).toMatch(/<p[^>]*>A paragraph\.<\/p>/);
  });

  it("populates the sourceMap with one entry per block", () => {
    const result = renderMarkdown({
      file: "doc.md",
      text: "# Title\n\nFirst.\n\nSecond.\n",
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.sourceMap.file).toBe("doc.md");
    const lines = result.sourceMap.blocks.map((b) => b.line).sort((a, b) => a - b);
    expect(lines).toEqual([1, 3, 5]);
    for (const block of result.sourceMap.blocks) {
      expect(block.colStart).toBe(0);
    }
  });

  it("tags every list item with its source line", () => {
    const text = "- one\n- two\n- three\n";
    const result = renderMarkdown({ file: "list.md", text });
    if (!result.ok) throw new Error("expected ok");
    const matches = [...result.html.matchAll(/<li[^>]*data-src-line="(\d+)"/g)];
    expect(matches.map((m) => m[1])).toEqual(["1", "2", "3"]);
  });

  it("handles a multi-line paragraph (line of the start anchor)", () => {
    const text = "first line\nsecond line\nthird line\n";
    const result = renderMarkdown({ file: "para.md", text });
    if (!result.ok) throw new Error("expected ok");
    expect(result.html).toMatch(/<p[^>]*data-src-line="1"/);
    expect(result.sourceMap.blocks).toHaveLength(1);
  });

  it("captures fenced code blocks", () => {
    const text = "Intro.\n\n```js\nconst x = 1;\n```\n";
    const result = renderMarkdown({ file: "code.md", text });
    if (!result.ok) throw new Error("expected ok");
    expect(result.html).toMatch(/<pre[^>]*data-src-line="3"/);
  });

  it("captures blockquotes and tables", () => {
    const text = ["> a quote", "", "| a | b |", "| - | - |", "| 1 | 2 |", ""].join("\n");
    const result = renderMarkdown({ file: "tbl.md", text });
    if (!result.ok) throw new Error("expected ok");
    expect(result.html).toMatch(/<blockquote[^>]*data-src-line="1"/);
    // Container tags (table/thead/tbody/tr) deliberately stay untagged;
    // their leaf cells (th/td) carry the source position instead.
    expect(result.html).toMatch(/<th[^>]*data-src-line="3"/);
    expect(result.html).toMatch(/<td[^>]*data-src-line="5"/);
  });

  it("does not render raw HTML in the source", () => {
    const result = renderMarkdown({
      file: "raw.md",
      text: "<script>alert(1)</script>\n\nsafe.\n",
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.html).not.toContain("<script>");
  });

  it("returns parse-failed only on truly invalid input", () => {
    // mdast is famously lenient — almost any string parses. This test
    // documents that contract: an empty string is a valid (empty) doc.
    const result = renderMarkdown({ file: "empty.md", text: "" });
    if (!result.ok) throw new Error("expected ok on empty input");
    expect(result.sourceMap.blocks).toEqual([]);
  });
});
