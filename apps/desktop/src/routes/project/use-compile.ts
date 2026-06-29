import type { Repository } from "@obelus/repo";
import { useState } from "react";
import { useAiEngine } from "../../hooks/use-ai-engine";
import { AiEngineMustPick, AiEngineUnavailable, type EngineGate } from "../../lib/ai-engine";
import { errorMessage } from "../../lib/errors";
import { kickFixCompile } from "./kick-fix-compile";

// Structural shape both `compileTypst` and `compileLatex` already satisfy.
// The desktop's LaTeX report carries an extra `engine` field that we don't
// need here; widening to the shared subset keeps callers decoupled from
// either compiler's full report type.
export interface CompileReport {
  outputRelPath: string;
  stderr: string;
  // 0 is a clean compile; non-zero is a compile failure whose diagnostic is in
  // `stderr`. A rejected promise means the engine couldn't run at all.
  exitCode: number;
}

export type CompileState =
  | { kind: "idle" }
  | { kind: "compiling" }
  | { kind: "done"; outputRelPath: string; warnings: string }
  // `stderr`/`exitCode` are present for a real compile failure (carried into the
  // fix-compile bundle) and absent when the compiler couldn't run at all.
  | { kind: "error"; message: string; stderr?: string; exitCode?: number }
  | { kind: "fixing" };

export interface UseCompileArgs {
  rootId: string;
  relPath: string;
  compile: (rootId: string, relPath: string) => Promise<CompileReport>;
  // Forwarded to the fix-compile bundle's `compiler` enum so the plugin routes
  // the error to the right repair skill.
  compilerToken: "typst" | "latexmk";
  // The paper the source compiles into. Null on a fresh repo before the PDF
  // exists — Compile still runs, but Fix-with-AI (keyed on a paperId) is hidden.
  fixPaperId: string | null;
  projectId: string;
  projectLabel: string;
  repo: Repository;
  // Called on a clean compile (exit 0) with the produced PDF's relPath. The
  // only behavioral seam between writing-mode CompilePane (open the PDF) and
  // the split's editor (refresh the already-open PDF).
  onCompiled: (outputRelPath: string) => void;
}

export interface UseCompileResult {
  state: CompileState;
  run: () => Promise<void>;
  askFix: () => Promise<void>;
  compileLabel: string;
  engineReady: boolean;
  engineGate: EngineGate;
  // Whether Fix-with-AI is reachable (a companion paper exists). Drives the
  // button's presence in CompileToolbar.
  canFix: boolean;
}

export function useCompile({
  rootId,
  relPath,
  compile,
  compilerToken,
  fixPaperId,
  projectId,
  projectLabel,
  repo,
  onCompiled,
}: UseCompileArgs): UseCompileResult {
  const engine = useAiEngine();
  const engineReady = engine.active !== null;
  const [state, setState] = useState<CompileState>({ kind: "idle" });

  const run = async (): Promise<void> => {
    setState({ kind: "compiling" });
    try {
      const report = await compile(rootId, relPath);
      if (report.exitCode !== 0) {
        setState({
          kind: "error",
          message: report.stderr || `exited with code ${report.exitCode}`,
          stderr: report.stderr,
          exitCode: report.exitCode,
        });
        return;
      }
      setState({ kind: "done", outputRelPath: report.outputRelPath, warnings: report.stderr });
      onCompiled(report.outputRelPath);
    } catch (err) {
      // A rejected promise is the "couldn't run" path (engine unresolved /
      // spawn failure); the message carries the real reason.
      setState({ kind: "error", message: errorMessage(err) });
    }
  };

  const askFix = async (): Promise<void> => {
    if (state.kind !== "error" || fixPaperId === null) return;
    const { message, stderr, exitCode } = state;
    setState({ kind: "fixing" });
    try {
      await kickFixCompile({
        repo,
        rootId,
        projectId,
        projectLabel,
        paperId: fixPaperId,
        originSessionId: null,
        compiler: compilerToken,
        // The user clicked Fix-with-AI while looking at `relPath`; that is the
        // compile that's failing and what the skill should repair. We
        // deliberately do NOT read `paperBuild.mainRelPath` — that value has
        // been observed to drift to unrelated paths and would mis-target.
        mainRelPath: relPath,
        stderr: stderr ?? message,
        ...(exitCode === undefined ? {} : { exitCode }),
        trigger: "manual",
      });
      setState({ kind: "idle" });
    } catch (err) {
      const next =
        err instanceof AiEngineMustPick
          ? "Pick an engine in Settings to enable AI fixes."
          : err instanceof AiEngineUnavailable
            ? "No AI engine is installed. Open Settings to install Claude Code or OpenCode, then try again."
            : errorMessage(err, "Could not start compile-fix.");
      setState({ kind: "error", message: next });
    }
  };

  const compileLabel =
    state.kind === "compiling"
      ? "Compiling…"
      : state.kind === "fixing"
        ? "Asking AI…"
        : "Compile → PDF";

  return {
    state,
    run,
    askFix,
    compileLabel,
    engineReady,
    engineGate: engine.gate,
    canFix: fixPaperId !== null,
  };
}
