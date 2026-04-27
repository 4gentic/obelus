import type { JSX } from "react";
import { useState } from "react";
import { compileLatex, type LatexCompiler } from "../../ipc/commands";
import { useProject } from "./context";
import { kickFixCompile } from "./kick-fix-compile";
import SourcePane from "./SourcePane";
import { useCompanionPaperId } from "./use-companion-paper";

interface Props {
  rootId: string;
  relPath: string;
}

type CompileState =
  | { kind: "idle" }
  | { kind: "compiling" }
  | { kind: "done"; outputRelPath: string; warnings: string }
  | { kind: "error"; message: string }
  | { kind: "fixing" };

// latexmk on PATH wins inside `compile_latex` if MacTeX/TeX Live is installed;
// otherwise the Rust resolver falls back to the managed Tectonic. Either way
// the compiler token stays "latexmk" so the fix-compile bundle's `compiler`
// enum value matches what the auto-compile flow uses.
const DEFAULT_COMPILER: LatexCompiler = "latexmk";

export default function LatexPane({ rootId, relPath }: Props): JSX.Element {
  const { repo, project, setOpenFilePath } = useProject();
  const [state, setState] = useState<CompileState>({ kind: "idle" });
  // Compile itself does not require a paper — that's the point of this
  // component on a freshly-cloned repo. Fix-with-AI does, because the
  // compile-error bundle is keyed on a paperId; we resolve the companion
  // best-effort and just hide the button when nothing matches.
  const fixPaperId = useCompanionPaperId(repo, project.id, relPath);

  const run = async (): Promise<void> => {
    setState({ kind: "compiling" });
    try {
      const report = await compileLatex(rootId, relPath, DEFAULT_COMPILER);
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
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const askFix = async (): Promise<void> => {
    if (state.kind !== "error" || fixPaperId === null) return;
    const errorMessage = state.message;
    setState({ kind: "fixing" });
    try {
      await kickFixCompile({
        repo,
        rootId,
        projectId: project.id,
        projectLabel: project.label,
        paperId: fixPaperId,
        originSessionId: null,
        compiler: DEFAULT_COMPILER,
        mainRelPath: relPath,
        stderr: errorMessage,
        trigger: "manual",
      });
      setState({ kind: "idle" });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Could not start compile-fix.",
      });
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
        <span className="compile-pane__label">LaTeX source</span>
        <div className="compile-pane__actions">
          {state.kind === "error" && fixPaperId !== null && (
            <button
              type="button"
              className="btn btn--subtle"
              onClick={() => void askFix()}
              title="Send the compile error to an AI fix-compile job"
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
