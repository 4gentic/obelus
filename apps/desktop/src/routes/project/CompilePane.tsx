import type { JSX } from "react";
import { useState } from "react";
import { useAiEngine } from "../../hooks/use-ai-engine";
import { AiEngineMustPick, AiEngineUnavailable } from "../../lib/ai-engine";
import { errorMessage } from "../../lib/errors";
import { useProject } from "./context";
import { kickFixCompile } from "./kick-fix-compile";
import SourcePane from "./SourcePane";
import { useCompanionPaperId } from "./use-companion-paper";

// Structural shape both `compileTypst` and `compileLatex` already satisfy.
// The desktop's LaTeX report carries an extra `engine` field that we don't
// need here; widening to the shared subset keeps CompilePane decoupled from
// either compiler's full report type.
export interface CompileReport {
  outputRelPath: string;
  stderr: string;
  // 0 is a clean compile; non-zero is a compile failure whose diagnostic is in
  // `stderr`. A rejected promise means the engine couldn't run at all.
  exitCode: number;
}

interface Props {
  rootId: string;
  relPath: string;
  label: string;
  compile: (rootId: string, relPath: string) => Promise<CompileReport>;
  // Forwarded to the fix-compile bundle's `compiler` enum so the plugin
  // routes the error to the right repair skill. Wrong values are filtered
  // upstream (`kick-fix-compile.ts:supportedCompiler`); we don't validate
  // here.
  compilerToken: "typst" | "latexmk";
}

type CompileState =
  | { kind: "idle" }
  | { kind: "compiling" }
  | { kind: "done"; outputRelPath: string; warnings: string }
  // `stderr`/`exitCode` are present for a real compile failure (carried into the
  // fix-compile bundle) and absent when the compiler couldn't run at all.
  | { kind: "error"; message: string; stderr?: string; exitCode?: number }
  | { kind: "fixing" };

export default function CompilePane({
  rootId,
  relPath,
  label,
  compile,
  compilerToken,
}: Props): JSX.Element {
  const { repo, project, setOpenFilePath } = useProject();
  const engine = useAiEngine();
  const engineReady = engine.active !== null;
  const [state, setState] = useState<CompileState>({ kind: "idle" });
  // Compile itself does not require a paper — that's the point of this
  // component on a freshly-cloned repo. Fix-with-AI does, because the
  // compile-error bundle is keyed on a paperId; resolve the companion
  // best-effort and just hide the button when nothing matches.
  const fixPaperId = useCompanionPaperId(repo, project.id, relPath);

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
      setState({
        kind: "done",
        outputRelPath: report.outputRelPath,
        warnings: report.stderr,
      });
      // Bounce via null so OpenPaper's effect fires even on repeat compiles
      // of the same path. On a fresh repo the freshly-written PDF is opened
      // here and findOrCreatePaper inside OpenPaper auto-registers the paper
      // row — that's how the workflow bootstraps without any "set up paper"
      // step beforehand.
      setOpenFilePath(null);
      requestAnimationFrame(() => setOpenFilePath(report.outputRelPath));
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
        projectId: project.id,
        projectLabel: project.label,
        paperId: fixPaperId,
        originSessionId: null,
        compiler: compilerToken,
        // The user clicked Fix-with-AI while looking at `relPath`; `relPath`
        // is the compile that's failing; `relPath` is what the skill should
        // repair. We deliberately do NOT read `paperBuild.mainRelPath` —
        // that value has been observed to drift to unrelated paths (e.g. a
        // markdown file in a sibling directory) and would mis-target the
        // repair.
        mainRelPath: relPath,
        stderr: stderr ?? message,
        ...(exitCode === undefined ? {} : { exitCode }),
        trigger: "manual",
      });
      setState({ kind: "idle" });
    } catch (err) {
      const message =
        err instanceof AiEngineMustPick
          ? "Pick an engine in Settings to enable AI fixes."
          : err instanceof AiEngineUnavailable
            ? "No AI engine is installed. Open Settings to install Claude Code or OpenCode, then try again."
            : errorMessage(err, "Could not start compile-fix.");
      setState({ kind: "error", message });
    }
  };

  const compileLabel =
    state.kind === "compiling"
      ? "Compiling…"
      : state.kind === "fixing"
        ? "Asking AI…"
        : "Compile → PDF";

  return (
    <div className="compile-pane">
      <header className="compile-pane__head">
        <span className="compile-pane__label">{label}</span>
        <div className="compile-pane__actions">
          {state.kind === "error" && fixPaperId !== null && (
            <button
              type="button"
              className="btn btn--subtle"
              onClick={() => void askFix()}
              disabled={!engineReady}
              title={
                engineReady
                  ? "Send the compile error to an AI fix-compile job"
                  : engine.gate === "must-pick"
                    ? "Pick an engine in Settings to enable AI fixes."
                    : "Install an AI engine from Settings to enable AI fixes."
              }
            >
              Fix with AI
            </button>
          )}
          <button
            type="button"
            className="btn btn--primary"
            disabled={state.kind === "compiling" || state.kind === "fixing"}
            onClick={() => void run()}
          >
            {compileLabel}
          </button>
        </div>
      </header>
      {state.kind === "error" && (
        <pre className="compile-pane__banner compile-pane__banner--err">{state.message}</pre>
      )}
      {state.kind === "done" && state.warnings.trim() !== "" && (
        <pre className="compile-pane__banner">{state.warnings}</pre>
      )}
      <div className="compile-pane__editor">
        <SourcePane rootId={rootId} relPath={relPath} />
      </div>
    </div>
  );
}
