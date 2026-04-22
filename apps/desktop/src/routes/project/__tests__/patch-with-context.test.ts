import { describe, expect, it } from "vitest";
import { buildDisplayLines } from "../patch-with-context";

describe("buildDisplayLines", () => {
  it("returns empty for empty patch", () => {
    expect(buildDisplayLines("", null, 3)).toEqual([]);
  });

  it("classifies minimal patch lines without source", () => {
    const patch = "@@ -17,1 +17,1 @@\n-old line\n+new line\n";
    const out = buildDisplayLines(patch, null, 3);
    expect(out).toEqual([
      { kind: "header", text: "@@ -17,1 +17,1 @@" },
      { kind: "old", text: "-old line" },
      { kind: "new", text: "+new line" },
    ]);
  });

  it("pads with 3 lines of context from source around a one-line swap", () => {
    const source = [
      "line 1",
      "line 2",
      "line 3",
      "line 4",
      "line 5",
      "the hot path (verbose)",
      "line 7",
      "line 8",
      "line 9",
      "line 10",
    ].join("\n");
    const patch = "@@ -6,1 +6,1 @@\n-the hot path (verbose)\n+the hot path\n";
    const out = buildDisplayLines(patch, source, 3);
    expect(out.map((l) => l.kind)).toEqual([
      "header",
      "ctx",
      "ctx",
      "ctx",
      "old",
      "new",
      "ctx",
      "ctx",
      "ctx",
    ]);
    expect(out[1]?.text).toBe(" line 3");
    expect(out[3]?.text).toBe(" line 5");
    expect(out[4]?.text).toBe("-the hot path (verbose)");
    expect(out[5]?.text).toBe("+the hot path");
    expect(out[6]?.text).toBe(" line 7");
    expect(out[8]?.text).toBe(" line 9");
  });

  it("clamps context at file start", () => {
    const source = "a\nb\nc";
    const patch = "@@ -1,1 +1,1 @@\n-a\n+A\n";
    const out = buildDisplayLines(patch, source, 3);
    const kinds = out.map((l) => l.kind);
    expect(kinds.indexOf("ctx")).toBeGreaterThan(kinds.indexOf("new"));
    expect(out.filter((l) => l.kind === "ctx").length).toBe(2);
  });
});
