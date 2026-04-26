import type { JSX } from "react";
import { useEffect, useState } from "react";
import { compileTypst } from "../../ipc/commands";
import { useProject } from "./context";
import { kickFixCompile } from "./kick-fix-compile";
import SourcePane from "./SourcePane";

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

function dirOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

export default function TypstPane({ rootId, relPath }: Props): JSX.Element {
  const { repo, project, setOpenFilePath } = useProject();
  const [state, setState] = useState<CompileState>({ kind: "idle" });
  // Paper this source belongs to — needed because the fix-compile flow must
  // create a review session against a paper row. We resolve it but do NOT
  // read paperBuild.mainRelPath here: that value has been observed to drift
  // to unrelated paths (e.g. a markdown file in a sibling directory) and
  // sending it as the compile entrypoint caused the desktop to try to
  // recompile the wrong file. The user clicked Fix with AI while looking at
  // `relPath`; `relPath` is the compile that's failing; `relPath` is what
  // the skill should repair. Matching order: companion PDF of the same stem
  // (paper/short/main.typ ↔ paper/short/main.pdf), else any paper whose PDF
  // is in the same folder or an ancestor.
  const [fixPaperId, setFixPaperId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const papers = await repo.papers.list();
      const inProject = papers.filter(
        (p) => p.projectId === project.id && p.removedAt === undefined,
      );

      const companionPdf = relPath.replace(/\.[^./]+$/, ".pdf");
      const byCompanion = inProject.find(
        (p) => p.pdfRelPath !== undefined && p.pdfRelPath === companionPdf,
      );

      const relDir = dirOf(relPath);
      const byDir = byCompanion
        ? undefined
        : inProject.find((p) => {
            if (p.pdfRelPath === undefined) return false;
            const pd = dirOf(p.pdfRelPath);
            if (pd === "" && relDir !== "") return false;
            return pd === relDir || relPath.startsWith(`${pd}/`);
          });

      const resolved = byCompanion?.id ?? byDir?.id ?? null;
      console.info("[typst-pane-fix-resolve]", {
        relPath,
        papersInProject: inProject.length,
        byCompanion: byCompanion?.id ?? null,
        byDir: byDir?.id ?? null,
        resolved,
      });
      if (!cancelled) setFixPaperId(resolved);
    })();
    return () => {
      cancelled = true;
    };
  }, [repo, project.id, relPath]);

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
        compiler: "typst",
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
    <div className="typst-pane">
      <header className="typst-pane__head">
        <span className="typst-pane__label">Typst source</span>
        <div className="typst-pane__actions">
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
