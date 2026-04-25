import { describe, expect, it } from "vitest";
import { formatSpawnInvocation } from "../formatters/format-spawn-invocation.js";

describe("formatSpawnInvocation", () => {
  it("renders apply-revision", () => {
    expect(
      formatSpawnInvocation({
        kind: "apply-revision",
        bundleAbsPath: "/app-data/projects/p/bundle-2026-04-23.json",
        workspaceAbsPath: "/app-data/projects/p",
      }),
    ).toMatchInlineSnapshot(`
      "/obelus:apply-revision /app-data/projects/p/bundle-2026-04-23.json
      Tool policy for this run: write only inside $OBELUS_WORKSPACE_DIR (/app-data/projects/p). Do NOT use Edit, Write, or any tool that mutates a source file under the project working tree — the desktop UI applies plans. If you conclude the bundle's edits are already in the working tree, STILL invoke plan-fix with every block ambiguous:true and a reviewer note explaining the no-op; every run must end with \`OBELUS_WROTE: $OBELUS_WORKSPACE_DIR/plan-<iso>.json\`.
      "
    `);
  });

  it("renders apply-revision with extra body", () => {
    expect(
      formatSpawnInvocation({
        kind: "apply-revision",
        bundleAbsPath: "/app-data/projects/p/bundle-2026-04-23.json",
        workspaceAbsPath: "/app-data/projects/p",
        extraBody: "## Indications for this pass\n\nFocus on the introduction.",
      }),
    ).toMatchInlineSnapshot(`
      "/obelus:apply-revision /app-data/projects/p/bundle-2026-04-23.json
      Tool policy for this run: write only inside $OBELUS_WORKSPACE_DIR (/app-data/projects/p). Do NOT use Edit, Write, or any tool that mutates a source file under the project working tree — the desktop UI applies plans. If you conclude the bundle's edits are already in the working tree, STILL invoke plan-fix with every block ambiguous:true and a reviewer note explaining the no-op; every run must end with \`OBELUS_WROTE: $OBELUS_WORKSPACE_DIR/plan-<iso>.json\`.

      ## Indications for this pass

      Focus on the introduction.
      "
    `);
  });

  it("renders plan-writer-fast", () => {
    expect(
      formatSpawnInvocation({
        kind: "plan-writer-fast",
        bundleAbsPath: "/repo/bundle-2026-04-23.json",
        workspaceAbsPath: "/app-data/projects/p",
      }),
    ).toMatchInlineSnapshot(`
      "/obelus:plan-writer-fast /repo/bundle-2026-04-23.json
      Tool policy: Read, Glob, Write only — no Bash, no Grep, no Edit. One turn: read the source windows the prelude lists, Write the .md and .json plans, end with \`OBELUS_WROTE: $OBELUS_WORKSPACE_DIR/plan-<iso>.json\` (workspace = /app-data/projects/p).
      "
    `);
  });

  it("renders plan-writer-fast with extra body", () => {
    expect(
      formatSpawnInvocation({
        kind: "plan-writer-fast",
        bundleAbsPath: "/repo/bundle-2026-04-23.json",
        workspaceAbsPath: "/app-data/projects/p",
        extraBody: "Focus on tone, leave numerical claims alone.",
      }),
    ).toMatchInlineSnapshot(`
      "/obelus:plan-writer-fast /repo/bundle-2026-04-23.json
      Tool policy: Read, Glob, Write only — no Bash, no Grep, no Edit. One turn: read the source windows the prelude lists, Write the .md and .json plans, end with \`OBELUS_WROTE: $OBELUS_WORKSPACE_DIR/plan-<iso>.json\` (workspace = /app-data/projects/p).

      Focus on tone, leave numerical claims alone.
      "
    `);
  });

  it("renders write-review without rubric", () => {
    expect(
      formatSpawnInvocation({
        kind: "write-review",
        bundleAbsPath: "/app-data/projects/p/bundle.json",
        paperId: "paper-1",
        paperTitle: "Attention is all you need",
      }),
    ).toMatchInlineSnapshot(`
      "/obelus:write-review /app-data/projects/p/bundle.json --out
      paperId: paper-1
      paperTitle: Attention is all you need
      "
    `);
  });

  it("renders write-review with rubric", () => {
    expect(
      formatSpawnInvocation({
        kind: "write-review",
        bundleAbsPath: "/app-data/projects/p/bundle.json",
        paperId: "paper-1",
        paperTitle: "Attention is all you need",
        rubricAbsPath: "/app-data/projects/p/rubric-paper-1.md",
      }),
    ).toMatchInlineSnapshot(`
      "/obelus:write-review /app-data/projects/p/bundle.json --out
      paperId: paper-1
      paperTitle: Attention is all you need
      rubricPath: /app-data/projects/p/rubric-paper-1.md
      "
    `);
  });

  it("renders fix-compile", () => {
    expect(
      formatSpawnInvocation({
        kind: "fix-compile",
        bundleAbsPath: "/app-data/projects/p/compile-error-20260424-091012.json",
        paperId: "paper-1",
      }),
    ).toMatchInlineSnapshot(`
      "/obelus:fix-compile /app-data/projects/p/compile-error-20260424-091012.json
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
