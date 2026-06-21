import { applyPatch } from "diff";
import { describe, expect, it } from "vitest";
import { parseChange, synthesizePatch } from "./change-model";

describe("parseChange", () => {
  it("returns null for an empty patch", () => {
    expect(parseChange("", "anything")).toBeNull();
  });

  it("returns null for an unparseable patch", () => {
    expect(parseChange("not a patch\n-x\n+y\n", null)).toBeNull();
  });

  it("reads before from source when available, after from the body", () => {
    const source = "alpha\nbeta\ngamma\ndelta\n";
    const patch = "@@ -2,1 +2,1 @@\n-beta\n+BETA\n";
    const change = parseChange(patch, source);
    expect(change).not.toBeNull();
    expect(change?.before).toBe("beta");
    expect(change?.after).toBe("BETA");
    expect(change?.contextBefore).toEqual(["alpha"]);
    expect(change?.contextAfter).toEqual(["gamma", "delta"]);
    expect(change?.oldStart).toBe(2);
    expect(change?.oldCount).toBe(1);
  });

  it("reconstructs before from the patch body when source is null", () => {
    const patch = "@@ -2,2 +2,2 @@\n keep\n-beta\n+BETA\n";
    const change = parseChange(patch, null);
    expect(change?.before).toBe("keep\nbeta");
    expect(change?.after).toBe("keep\nBETA");
    expect(change?.contextBefore).toEqual([]);
    expect(change?.contextAfter).toEqual([]);
  });

  it("represents a pure insertion as an empty before", () => {
    const source = "first\nsecond\n";
    // oldCount 0: the hunk inserts after line 1 without replacing anything.
    const patch = "@@ -1,0 +2,1 @@\n+inserted\n";
    const change = parseChange(patch, source);
    expect(change?.before).toBe("");
    expect(change?.after).toBe("inserted");
    expect(change?.oldCount).toBe(0);
  });

  it("represents a pure deletion as an empty after", () => {
    const source = "keep\ndrop\nkeep too\n";
    const patch = "@@ -2,1 +1,0 @@\n-drop\n";
    const change = parseChange(patch, source);
    expect(change?.before).toBe("drop");
    expect(change?.after).toBe("");
  });

  it("defaults an omitted count to 1", () => {
    const source = "only line\n";
    const patch = "@@ -1 +1 @@\n-only line\n+ONLY LINE\n";
    const change = parseChange(patch, source);
    expect(change?.oldCount).toBe(1);
    expect(change?.before).toBe("only line");
  });
});

// Every synthesized patch carries only `@@` hunks — no Index:/---/+++ headers —
// to match stored patches and the Rust apply path.
function assertNoFileHeaders(patch: string): void {
  expect(patch).not.toMatch(/^---/m);
  expect(patch).not.toMatch(/^\+\+\+/m);
  expect(patch).not.toMatch(/^Index:/m);
  expect(patch.startsWith("@@")).toBe(true);
}

describe("synthesizePatch", () => {
  it("synthesizes a single-word substitution as a hunk-only patch", () => {
    const source = "The cat sat on the mat.\n";
    const original = "@@ -1,1 +1,1 @@\n-The cat sat on the mat.\n+The cat slept on the mat.\n";
    const out = synthesizePatch(source, original, "The cat slept on the rug.");
    assertNoFileHeaders(out);
    const applied = applyPatch(source, out);
    expect(applied).toBe("The cat slept on the rug.\n");
  });

  it("returns an empty string when the original patch header is unparseable", () => {
    expect(synthesizePatch("x\n", "garbage\n", "y")).toBe("");
  });

  it("produces an empty patch for a no-op edit", () => {
    const source = "one\ntwo\nthree\n";
    const original = "@@ -2,1 +2,1 @@\n-two\n+TWO\n";
    // Editing back to the original span text means nothing changed.
    const out = synthesizePatch(source, original, "two");
    expect(out).toBe("");
  });

  it("handles a multi-line replacement", () => {
    const source = "a\nb\nc\nd\ne\n";
    const original = "@@ -2,2 +2,2 @@\n-b\n-c\n+B\n+C\n";
    const out = synthesizePatch(source, original, "B2\nC2\nC3");
    assertNoFileHeaders(out);
    const applied = applyPatch(source, out);
    expect(applied).toBe("a\nB2\nC2\nC3\nd\ne\n");
  });

  it("synthesizes a pure deletion", () => {
    const source = "keep\ndrop\nkeep too\n";
    const original = "@@ -2,1 +2,1 @@\n-drop\n+changed\n";
    const out = synthesizePatch(source, original, "");
    assertNoFileHeaders(out);
    const applied = applyPatch(source, out);
    // Replacing line 2 with "" leaves a blank line where "drop" was.
    expect(applied).toBe("keep\n\nkeep too\n");
  });

  it("preserves a source with no trailing newline", () => {
    const source = "first\nlast";
    const original = "@@ -2,1 +2,1 @@\n-last\n+LAST\n";
    const out = synthesizePatch(source, original, "LAST");
    assertNoFileHeaders(out);
    const applied = applyPatch(source, out);
    expect(applied).toBe("first\nLAST");
  });

  it("does not introduce a spurious final-line diff", () => {
    const source = "intro\ntarget\ntail one\ntail two\n";
    const original = "@@ -2,1 +2,1 @@\n-target\n+TARGET\n";
    const out = synthesizePatch(source, original, "REWORDED");
    // The edit touches one line; the trailing lines appear only as context
    // (leading-space lines), never as additions/removals. A spurious final-line
    // diff would surface them as `-tail two` / `+tail two`.
    expect(out).not.toContain("-tail two");
    expect(out).not.toContain("+tail two");
    // A single contiguous edit yields a single hunk.
    expect(out.match(/^@@ /gm)?.length).toBe(1);
    const applied = applyPatch(source, out);
    expect(applied).toBe("intro\nREWORDED\ntail one\ntail two\n");
  });
});

describe("synthesize → apply round-trip", () => {
  it("reproduces a file whose changed span equals editedAfter", () => {
    const source = "Section one.\nThe quick brown fox.\nSection three.\nSection four.\n";
    const original = "@@ -2,1 +2,1 @@\n-The quick brown fox.\n+The quick red fox.\n";
    const editedAfter = "The slow grey wolf paused, then ran.";
    const synthesized = synthesizePatch(source, original, editedAfter);
    assertNoFileHeaders(synthesized);

    const applied = applyPatch(source, synthesized);
    expect(applied).toBe(
      "Section one.\nThe slow grey wolf paused, then ran.\nSection three.\nSection four.\n",
    );
    // The changed span, read back out of the applied file, is exactly editedAfter.
    expect(applied === false ? null : applied.split("\n")[1]).toBe(editedAfter);
  });

  it("round-trips a multi-line edited span", () => {
    const source = "head\nold a\nold b\ntail\n";
    const original = "@@ -2,2 +2,2 @@\n-old a\n-old b\n+new a\n+new b\n";
    const editedAfter = "rewritten a\nrewritten b\nrewritten c";
    const synthesized = synthesizePatch(source, original, editedAfter);
    const applied = applyPatch(source, synthesized);
    expect(applied).toBe("head\nrewritten a\nrewritten b\nrewritten c\ntail\n");
  });
});
