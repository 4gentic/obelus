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
});
