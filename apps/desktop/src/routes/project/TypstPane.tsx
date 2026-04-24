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

export default function TypstPane({ rootId, relPath }: Props): JSX.Element {
  const { repo, project, setOpenFilePath } = useProject();
  const [state, setState] = useState<CompileState>({ kind: "idle" });
  const [paperIdForFix, setPaperIdForFix] = useState<string | null>(null);

  // Resolve a paper whose main matches this source file. The fix-compile flow
  // requires a paperId to create a review session; no match means no button.
  // Matching strategy: (1) a paperBuild explicitly marked main=relPath, or
  // (2) a paper whose pdfRelPath is the source's same-stem .pdf companion
  // (e.g. source paper/short/main.typ ↔ paper paper/short/main.pdf).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const papers = await repo.papers.list();
      const inProject = papers.filter((p) => p.projectId === project.id);
      const builds = await Promise.all(inProject.map((p) => repo.paperBuild.get(p.id)));
      const byBuild = inProject.find((_, i) => builds[i]?.mainRelPath === relPath);
      const companionPdf = relPath.replace(/\.[^./]+$/, ".pdf");
      const byCompanion = byBuild ? null : inProject.find((p) => p.pdfRelPath === companionPdf);
      const resolved = byBuild?.id ?? byCompanion?.id ?? null;
      console.info("[typst-pane-fix-resolve]", {
        relPath,
        papersInProject: inProject.length,
        byBuild: byBuild?.id ?? null,
        byCompanion: byCompanion?.id ?? null,
        resolved,
      });
      if (!cancelled) setPaperIdForFix(resolved);
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
    if (state.kind !== "error" || paperIdForFix === null) return;
    const errorMessage = state.message;
    setState({ kind: "fixing" });
    try {
      await kickFixCompile({
        repo,
        rootId,
        projectId: project.id,
        projectLabel: project.label,
        paperId: paperIdForFix,
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
          {state.kind === "error" && paperIdForFix !== null && (
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
