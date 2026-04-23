import type { Repository } from "@obelus/repo";
import { compileLatex, compileTypst, type LatexCompiler } from "../../ipc/commands";

export type AutoCompileTrigger = "apply" | "switch";

export type AutoCompileOutcome =
  | { kind: "compiled"; outputRelPath: string; stderr: string }
  | { kind: "error"; message: string }
  | { kind: "hint"; message: string }
  | { kind: "noop" };

export interface AutoCompileArgs {
  repo: Repository;
  rootId: string;
  paperId: string;
  trigger: AutoCompileTrigger;
  // The file currently open in the reviewer, if any. Logged alongside the
  // compile output path so "did we overwrite the file the user is watching?"
  // is a fact the next debugger can read without re-deriving it.
  reviewedRelPath?: string | null;
}

const LATEX_COMPILERS = new Set<string>(["latexmk", "xelatex", "pdflatex"]);

// Runs the per-paper compiler after a draft is created or switched.
// Typst and LaTeX (via latexmk) are wired end-to-end; pandoc/markdown stays
// silent. Never throws — returns a tagged outcome so callers can decide how
// to surface it.
export async function autoCompileAfterDraftChange(
  args: AutoCompileArgs,
): Promise<AutoCompileOutcome> {
  const { repo, rootId, paperId, trigger, reviewedRelPath = null } = args;
  const build = await repo.paperBuild.get(paperId).catch(() => undefined);
  const compiler = build?.compiler ?? null;
  const mainRelPath = build?.mainRelPath ?? null;

  const outcome = await runForCompiler({ compiler, mainRelPath, rootId });

  const outputRelPath = outcome.kind === "compiled" ? outcome.outputRelPath : null;
  console.info("[auto-compile]", {
    trigger,
    paperId,
    compiler,
    mainRelPath,
    reviewedRelPath,
    outputRelPath,
    match: outputRelPath !== null && outputRelPath === reviewedRelPath,
    outcome: outcome.kind,
  });

  return outcome;
}

async function runForCompiler(args: {
  compiler: string | null;
  mainRelPath: string | null;
  rootId: string;
}): Promise<AutoCompileOutcome> {
  const { compiler, mainRelPath, rootId } = args;
  if (!compiler || !mainRelPath) return { kind: "noop" };

  if (compiler === "typst") {
    try {
      const report = await compileTypst(rootId, mainRelPath);
      return {
        kind: "compiled",
        outputRelPath: report.outputRelPath,
        stderr: report.stderr,
      };
    } catch (err) {
      return {
        kind: "error",
        message: err instanceof Error ? err.message : "Typst compile failed.",
      };
    }
  }

  if (LATEX_COMPILERS.has(compiler)) {
    try {
      const report = await compileLatex(rootId, mainRelPath, compiler as LatexCompiler);
      return {
        kind: "compiled",
        outputRelPath: report.outputRelPath,
        stderr: report.stderr,
      };
    } catch (err) {
      return {
        kind: "error",
        message: err instanceof Error ? err.message : `${compiler} compile failed.`,
      };
    }
  }

  return { kind: "noop" };
}
