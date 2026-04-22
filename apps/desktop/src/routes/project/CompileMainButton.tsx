import type { JSX } from "react";
import { useState } from "react";
import { compileTypst } from "../../ipc/commands";
import { useProject } from "./context";
import { usePaperId } from "./OpenPaper";
import { usePaperBuild } from "./use-paper-build";

type CompileState =
  | { kind: "idle" }
  | { kind: "compiling" }
  | { kind: "done"; outputRelPath: string }
  | { kind: "error"; message: string };

// Surfaces the "compile whatever you usually compile" affordance from any
// source file: resolves the main file via the open paper's paper_build row and
// dispatches to the appropriate compiler. LaTeX/Pandoc are recognised but
// intentionally unwired in this pass — we surface an actionable hint instead
// of a silent no-op.
export default function CompileMainButton(): JSX.Element | null {
  const { repo, rootId, setOpenFilePath } = useProject();
  const paperId = usePaperId();
  const { build } = usePaperBuild(repo, paperId);
  const [state, setState] = useState<CompileState>({ kind: "idle" });

  if (!build || !build.mainRelPath || !build.compiler) {
    return null;
  }

  const run = async (): Promise<void> => {
    if (!build.mainRelPath || !build.compiler) return;
    setState({ kind: "compiling" });
    try {
      if (build.compiler !== "typst") {
        setState({
          kind: "error",
          message: `${build.compiler} compile is not wired yet — install typst or set the main file to a .typ for now.`,
        });
        return;
      }
      const report = await compileTypst(rootId, build.mainRelPath);
      setState({ kind: "done", outputRelPath: report.outputRelPath });
      setOpenFilePath(null);
      requestAnimationFrame(() => setOpenFilePath(report.outputRelPath));
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Compile failed.",
      });
    }
  };

  const label =
    state.kind === "compiling" ? "Compiling…" : `Compile ${shortLabel(build.mainRelPath)}`;

  return (
    <div className="compile-main">
      <button
        type="button"
        className="btn btn--subtle"
        disabled={state.kind === "compiling"}
        onClick={() => void run()}
        title={`Main: ${build.mainRelPath}`}
      >
        {label}
      </button>
      {state.kind === "error" && <span className="compile-main__err">{state.message}</span>}
    </div>
  );
}

function shortLabel(rel: string): string {
  const idx = rel.lastIndexOf("/");
  return idx === -1 ? rel : rel.slice(idx + 1);
}
