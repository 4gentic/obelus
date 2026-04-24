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

interface FixTarget {
  paperId: string;
  mainRelPath: string;
}

function dirOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

export default function TypstPane({ rootId, relPath }: Props): JSX.Element {
  const { repo, project, setOpenFilePath } = useProject();
  const [state, setState] = useState<CompileState>({ kind: "idle" });
  const [fixTarget, setFixTarget] = useState<FixTarget | null>(null);

  // Resolve a paper this source file belongs to, so Fix with AI can kick a
  // fix-compile session against it. The fix-compile flow requires a paperId,
  // so no match means no button. Matching (first hit wins):
  //   (1) a paperBuild explicitly marked main=relPath (user set this file as main)
  //   (2) a paper whose pdfRelPath is the same-stem .pdf companion of relPath
  //       (e.g. paper/short/main.typ ↔ paper/short/main.pdf)
  //   (3) a paper whose pdfRelPath lives in the same directory as relPath, or
  //       an ancestor directory (covers section files included from a main in
  //       the same folder, e.g. paper/short/01-introduction.typ ↔ paper at
  //       paper/short/main.pdf)
  // The resolved mainRelPath is the paper's explicit main if set, else relPath.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const papers = await repo.papers.list();
      const inProject = papers.filter((p) => p.projectId === project.id);
      const builds = await Promise.all(inProject.map((p) => repo.paperBuild.get(p.id)));
      const mainOf = (i: number): string => builds[i]?.mainRelPath ?? relPath;

      const byBuildIdx = inProject.findIndex((_, i) => builds[i]?.mainRelPath === relPath);
      const byBuild = byBuildIdx >= 0 ? inProject[byBuildIdx] : undefined;

      const companionPdf = relPath.replace(/\.[^./]+$/, ".pdf");
      const byCompanionIdx = byBuild
        ? -1
        : inProject.findIndex((p) => p.pdfRelPath !== undefined && p.pdfRelPath === companionPdf);
      const byCompanion = byCompanionIdx >= 0 ? inProject[byCompanionIdx] : undefined;

      const relDir = dirOf(relPath);
      const byDirIdx =
        byBuild || byCompanion
          ? -1
          : inProject.findIndex((p) => {
              if (p.pdfRelPath === undefined) return false;
              const pd = dirOf(p.pdfRelPath);
              if (pd === "" && relDir !== "") return false;
              return pd === relDir || relPath.startsWith(`${pd}/`);
            });
      const byDir = byDirIdx >= 0 ? inProject[byDirIdx] : undefined;

      const hitIdx = byBuild ? byBuildIdx : byCompanion ? byCompanionIdx : byDirIdx;
      const hit = byBuild ?? byCompanion ?? byDir;
      const resolved: FixTarget | null =
        hit && hitIdx >= 0 ? { paperId: hit.id, mainRelPath: mainOf(hitIdx) } : null;

      console.info("[typst-pane-fix-resolve]", {
        relPath,
        papersInProject: inProject.length,
        byBuild: byBuild?.id ?? null,
        byCompanion: byCompanion?.id ?? null,
        byDir: byDir?.id ?? null,
        resolved,
      });
      if (!cancelled) setFixTarget(resolved);
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
    if (state.kind !== "error" || fixTarget === null) return;
    const errorMessage = state.message;
    setState({ kind: "fixing" });
    try {
      await kickFixCompile({
        repo,
        rootId,
        projectId: project.id,
        projectLabel: project.label,
        paperId: fixTarget.paperId,
        originSessionId: null,
        compiler: "typst",
        mainRelPath: fixTarget.mainRelPath,
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
          {state.kind === "error" && fixTarget !== null && (
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
