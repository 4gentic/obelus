import type { JSX } from "react";
import CompileToolbar from "./CompileToolbar";
import { useProject } from "./context";
import SourcePane from "./SourcePane";
import { setShowSource } from "./source-split-store";
import { useCompanionPaperId } from "./use-companion-paper";
import { type CompileReport, useCompile } from "./use-compile";

interface Props {
  rootId: string;
  relPath: string;
  label: string;
  compile: (rootId: string, relPath: string) => Promise<CompileReport>;
  compilerToken: "typst" | "latexmk";
}

// Writing-mode editor for a `.tex`/`.typ` entry file (no PDF open yet). A clean
// compile opens the produced PDF and turns the source split on, landing the
// writer in the unified view with this editor still beside the PDF.
export default function CompilePane({
  rootId,
  relPath,
  label,
  compile,
  compilerToken,
}: Props): JSX.Element {
  const { repo, project, setOpenFilePath } = useProject();
  // Compile itself does not require a paper — that's the point of this
  // component on a freshly-cloned repo. Fix-with-AI does; resolve the companion
  // best-effort and let the toolbar hide the button when nothing matches.
  const fixPaperId = useCompanionPaperId(repo, project.id, relPath);
  const compileState = useCompile({
    rootId,
    relPath,
    compile,
    compilerToken,
    fixPaperId,
    projectId: project.id,
    projectLabel: project.label,
    repo,
    onCompiled: (outputRelPath) => {
      // On a fresh repo the freshly-written PDF is opened here and
      // findOrCreatePaper inside OpenPaper auto-registers the paper row — that's
      // how the workflow bootstraps without any "set up paper" step. The path
      // genuinely changes (source → PDF), so OpenPaper's effect fires.
      setShowSource(project.id, true);
      setOpenFilePath(outputRelPath);
    },
  });

  return (
    <div className="compile-pane">
      <CompileToolbar label={label} compile={compileState} />
      <div className="compile-pane__editor">
        <SourcePane rootId={rootId} relPath={relPath} />
      </div>
    </div>
  );
}
