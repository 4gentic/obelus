// Spawn-invocation prompts are the 1-3 line strings the desktop hands to
// `claude` on the CLI. They are deliberately terse: the SKILL is the smart
// side (rules, examples, refusals all live in `packages/claude-plugin/`), the
// spawn just triggers it. Standard shape: a `/obelus:<skill> <bundle-path>`
// slash command on the first line (the canonical Claude Code invocation form
// — the imperative `Run <skill> …` shape works on Sonnet but Haiku treats it
// as a free-form instruction and goes hunting for a binary), then `key: value`
// pairs one per line, then optional extraBody. Do not add prose, examples, or
// rules here — duplicating them with the SKILL is exactly the drift this
// package was built to prevent.

export type SpawnInvocationInput =
  | {
      kind: "apply-revision";
      bundleAbsPath: string;
      workspaceAbsPath: string;
      extraBody?: string;
    }
  | {
      kind: "plan-writer-fast";
      bundleAbsPath: string;
      workspaceAbsPath: string;
      extraBody?: string;
    }
  | {
      kind: "write-review";
      bundleAbsPath: string;
      paperId: string;
      paperTitle: string;
      rubricAbsPath?: string;
      extraBody?: string;
    }
  | {
      kind: "fix-compile";
      bundleAbsPath: string;
      paperId: string;
      extraBody?: string;
    }
  | {
      kind: "ask";
      promptBody: string;
    };

function withTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s : `${s}\n`;
}

function appendExtra(base: string, extra: string | undefined): string {
  if (!extra || extra.trim().length === 0) return base;
  return `${base}\n${withTrailingNewline(extra)}`;
}

export function formatSpawnInvocation(input: SpawnInvocationInput): string {
  switch (input.kind) {
    case "apply-revision": {
      // Tool-policy clause. Kept in lockstep with the Rust spawn in
      // apps/desktop/src-tauri/src/commands/claude_session.rs::claude_spawn
      // — if either side changes, update both so the snapshot stays true.
      const base =
        `/obelus:apply-revision ${input.bundleAbsPath}\n` +
        `Tool policy for this run: write only inside $OBELUS_WORKSPACE_DIR (${input.workspaceAbsPath}). Do NOT use Edit, Write, or any tool that mutates a source file under the project working tree — the desktop UI applies plans. If you conclude the bundle's edits are already in the working tree, STILL invoke plan-fix with every block ambiguous:true and a reviewer note explaining the no-op; every run must end with \`OBELUS_WROTE: $OBELUS_WORKSPACE_DIR/plan-<iso>.json\`.\n`;
      return appendExtra(base, input.extraBody);
    }
    case "plan-writer-fast": {
      // Tool-policy clause. Kept in lockstep with the Rust spawn in
      // apps/desktop/src-tauri/src/commands/claude_session.rs::claude_spawn
      // — if either side changes, update both so the snapshot stays true.
      // Mirrors plan-writer-fast's frontmatter (`allowed-tools: Read Glob
      // Write`) into the prompt as defense-in-depth: Sonnet otherwise reaches
      // for Bash mid-run, which blows the one-turn budget the skill is named
      // for.
      const base =
        `/obelus:plan-writer-fast ${input.bundleAbsPath}\n` +
        `Tool policy: Read, Glob, Write only — no Bash, no Grep, no Edit. One turn: read the source windows the prelude lists, Write the .md and .json plans, end with \`OBELUS_WROTE: $OBELUS_WORKSPACE_DIR/plan-<iso>.json\` (workspace = ${input.workspaceAbsPath}).\n`;
      return appendExtra(base, input.extraBody);
    }
    case "write-review": {
      const lines = [
        `/obelus:write-review ${input.bundleAbsPath} --out`,
        `paperId: ${input.paperId}`,
        `paperTitle: ${input.paperTitle}`,
      ];
      if (input.rubricAbsPath !== undefined && input.rubricAbsPath.trim().length > 0) {
        lines.push(`rubricPath: ${input.rubricAbsPath}`);
      }
      const base = `${lines.join("\n")}\n`;
      return appendExtra(base, input.extraBody);
    }
    case "fix-compile": {
      const lines = [`/obelus:fix-compile ${input.bundleAbsPath}`, `paperId: ${input.paperId}`];
      const base = `${lines.join("\n")}\n`;
      return appendExtra(base, input.extraBody);
    }
    case "ask":
      return withTrailingNewline(input.promptBody);
  }
}
