import type { JSX } from "react";
import { useState } from "react";
import { compileTypst } from "../../ipc/commands";
import { useProject } from "./context";
import SourcePane from "./SourcePane";

interface Props {
  rootId: string;
  relPath: string;
}

type CompileState =
  | { kind: "idle" }
  | { kind: "compiling" }
  | { kind: "done"; outputRelPath: string; warnings: string }
  | { kind: "error"; message: string };

export default function TypstPane({ rootId, relPath }: Props): JSX.Element {
  const { setOpenFilePath } = useProject();
  const [state, setState] = useState<CompileState>({ kind: "idle" });

  const run = async (): Promise<void> => {
    setState({ kind: "compiling" });
    try {
      const report = await compileTypst(rootId, relPath);
      setState({
        kind: "done",
        outputRelPath: report.outputRelPath,
        warnings: report.stderr,
      });
      // Bounce via null so OpenPaper's effect fires even on repeat compiles of
      // the same path — the rendered bytes have changed, but the key hasn't.
      setOpenFilePath(null);
      requestAnimationFrame(() => setOpenFilePath(report.outputRelPath));
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div className="typst-pane">
      <header className="typst-pane__head">
        <span className="typst-pane__label">Typst source</span>
        <button
          type="button"
          className="btn btn--primary"
          disabled={state.kind === "compiling"}
          onClick={() => void run()}
        >
          {state.kind === "compiling" ? "Compiling…" : "Compile → PDF"}
        </button>
      </header>
      {state.kind === "error" && (
        <pre className="typst-pane__banner typst-pane__banner--err">{state.message}</pre>
      )}
      {state.kind === "done" && state.warnings.trim() !== "" && (
        <pre className="typst-pane__banner">{state.warnings}</pre>
      )}
      <div className="typst-pane__editor">
        <SourcePane rootId={rootId} relPath={relPath} />
      </div>
    </div>
  );
}
