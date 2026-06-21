import { describe, expect, it } from "vitest";
import { buildCodeRows } from "./CodeDiff";

describe("buildCodeRows", () => {
  it("marks exactly the one changed line in a big block, rest context", () => {
    const before = [
      "#set document(title: [Paper])",
      "#set page(margin: 2cm)",
      '#set text(font: "New Computer Modern")',
      "#set par(justify: true)",
      "#align(center)[Title]",
    ].join("\n");
    const after = [
      "#set document(title: [Paper])",
      "#set page(margin: 2cm)",
      '#set text(font: "New Computer Modern")',
      "#set par(justify: false)",
      "#align(center)[Title]",
    ].join("\n");

    const rows = buildCodeRows(before, after);

    expect(rows.filter((r) => r.kind === "removed")).toEqual([
      { kind: "removed", text: "#set par(justify: true)" },
    ]);
    expect(rows.filter((r) => r.kind === "added")).toEqual([
      { kind: "added", text: "#set par(justify: false)" },
    ]);
    expect(rows.filter((r) => r.kind === "context").length).toBe(4);
  });

  it("does not emit a phantom trailing row for newline-terminated input", () => {
    const rows = buildCodeRows("a\nb\nc\n", "a\nB\nc\n");
    expect(rows.map((r) => r.text)).toEqual(["a", "b", "B", "c"]);
  });

  it("renders every line of input with no trailing newline", () => {
    const rows = buildCodeRows("a\nb", "a\nb");
    expect(rows.map((r) => r.text)).toEqual(["a", "b"]);
    expect(rows.every((r) => r.kind === "context")).toBe(true);
  });

  it("represents a pure insertion as added rows only", () => {
    const rows = buildCodeRows("a\nc", "a\nb\nc");
    expect(rows.filter((r) => r.kind === "removed")).toEqual([]);
    expect(rows.filter((r) => r.kind === "added")).toEqual([{ kind: "added", text: "b" }]);
  });

  it("represents a pure deletion as removed rows only", () => {
    const rows = buildCodeRows("a\nb\nc", "a\nc");
    expect(rows.filter((r) => r.kind === "added")).toEqual([]);
    expect(rows.filter((r) => r.kind === "removed")).toEqual([{ kind: "removed", text: "b" }]);
  });

  it("marks consecutive changed lines as a removed run then an added run", () => {
    const rows = buildCodeRows("a\nx\ny\nb", "a\nX\nY\nb");
    expect(rows.map((r) => [r.kind, r.text])).toEqual([
      ["context", "a"],
      ["removed", "x"],
      ["removed", "y"],
      ["added", "X"],
      ["added", "Y"],
      ["context", "b"],
    ]);
  });

  it("represents a whole-block replacement as all removed then all added", () => {
    const rows = buildCodeRows("a\nb", "c\nd");
    expect(rows.filter((r) => r.kind === "removed").map((r) => r.text)).toEqual(["a", "b"]);
    expect(rows.filter((r) => r.kind === "added").map((r) => r.text)).toEqual(["c", "d"]);
  });

  it("preserves a leading blank line as an empty-text row", () => {
    const rows = buildCodeRows("\na", "\nb");
    expect(rows.map((r) => [r.kind, r.text])).toEqual([
      ["context", ""],
      ["removed", "a"],
      ["added", "b"],
    ]);
  });

  it("treats lines that start with + or - as literal text, not diff sigils", () => {
    const rows = buildCodeRows("+plus\n-minus", "+plus\n-MINUS");
    expect(rows.map((r) => [r.kind, r.text])).toEqual([
      ["context", "+plus"],
      ["removed", "-minus"],
      ["added", "-MINUS"],
    ]);
  });
});
