// Spawn-invocation prompts are the 1-3 line strings the desktop hands to
// `claude` on the CLI. They are deliberately terse: the SKILL is the smart
// side (rules, examples, refusals all live in `packages/claude-plugin/`), the
// spawn just triggers it. Standard shape: one `Run <skill> with bundle path
// <abs>.` line, then `key: value` pairs one per line, then optional extraBody.
// Do not add prose, examples, or rules here — duplicating them with the SKILL
// is exactly the drift this package was built to prevent.

export type SpawnInvocationInput =
  | {
      kind: "apply-revision";
      bundleAbsPath: string;
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
      const base = `Run apply-revision with bundle path ${input.bundleAbsPath}.\n`;
      return appendExtra(base, input.extraBody);
    }
    case "write-review": {
      const lines = [
        `Run write-review with bundle path ${input.bundleAbsPath}.`,
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
      const lines = [
        `Run fix-compile with bundle path ${input.bundleAbsPath}.`,
        `paperId: ${input.paperId}`,
      ];
      const base = `${lines.join("\n")}\n`;
      return appendExtra(base, input.extraBody);
    }
    case "ask":
      return withTrailingNewline(input.promptBody);
  }
}
