import { describe, expect, it } from "vitest";
import { formatSpawnInvocation } from "../formatters/format-spawn-invocation.js";

describe("formatSpawnInvocation", () => {
  it("renders apply-revision", () => {
    expect(
      formatSpawnInvocation({
        kind: "apply-revision",
        bundleAbsPath: "/repo/bundle-2026-04-23.json",
      }),
    ).toMatchInlineSnapshot(`
      "Run apply-revision with bundle path /repo/bundle-2026-04-23.json.
      "
    `);
  });

  it("renders apply-revision with extra body", () => {
    expect(
      formatSpawnInvocation({
        kind: "apply-revision",
        bundleAbsPath: "/repo/bundle-2026-04-23.json",
        extraBody: "## Indications for this pass\n\nFocus on the introduction.",
      }),
    ).toMatchInlineSnapshot(`
      "Run apply-revision with bundle path /repo/bundle-2026-04-23.json.

      ## Indications for this pass

      Focus on the introduction.
      "
    `);
  });

  it("renders write-review without rubric", () => {
    expect(
      formatSpawnInvocation({
        kind: "write-review",
        bundleAbsPath: "/repo/bundle.json",
        paperId: "paper-1",
        paperTitle: "Attention is all you need",
      }),
    ).toMatchInlineSnapshot(`
      "Run write-review with bundle path /repo/bundle.json --out.
      paperId: paper-1
      paperTitle: Attention is all you need
      "
    `);
  });

  it("renders write-review with rubric", () => {
    expect(
      formatSpawnInvocation({
        kind: "write-review",
        bundleAbsPath: "/repo/bundle.json",
        paperId: "paper-1",
        paperTitle: "Attention is all you need",
        rubricAbsPath: "/repo/.obelus/rubric-paper-1.md",
      }),
    ).toMatchInlineSnapshot(`
      "Run write-review with bundle path /repo/bundle.json --out.
      paperId: paper-1
      paperTitle: Attention is all you need
      rubricPath: /repo/.obelus/rubric-paper-1.md
      "
    `);
  });

  it("renders fix-compile", () => {
    expect(
      formatSpawnInvocation({
        kind: "fix-compile",
        bundleAbsPath: "/repo/.obelus-compile-error-20260424-091012.json",
        paperId: "paper-1",
      }),
    ).toMatchInlineSnapshot(`
      "Run fix-compile with bundle path /repo/.obelus-compile-error-20260424-091012.json.
      paperId: paper-1
      "
    `);
  });

  it("renders ask, ensuring trailing newline", () => {
    expect(
      formatSpawnInvocation({
        kind: "ask",
        promptBody: "What is the relationship between X and Y?",
      }),
    ).toMatchInlineSnapshot(`
      "What is the relationship between X and Y?
      "
    `);
  });

  it("preserves an existing trailing newline on ask", () => {
    expect(
      formatSpawnInvocation({
        kind: "ask",
        promptBody: "Already terminated.\n",
      }),
    ).toMatchInlineSnapshot(`
      "Already terminated.
      "
    `);
  });
});
