import type { JSX } from "react";
import { useProject } from "./context";
import MdReviewerPane from "./MdReviewerPane";
import { useOpenPaper } from "./OpenPaper";
import { extensionOf, SOURCE_EXTS } from "./openable";
import PdfPane from "./PdfPane";
import SourcePane from "./SourcePane";
import TypstPane from "./TypstPane";
import UnsupportedPane from "./UnsupportedPane";
export default function CenterPane(): JSX.Element {
  const { project, openFilePath, rootId } = useProject();
  const openPaper = useOpenPaper();

  const absolutePath = openFilePath ? `${project.root}/${openFilePath}` : null;

  const body = ((): JSX.Element => {
    if (!openFilePath) return <UnsupportedPane path={null} />;
    const ext = extensionOf(openFilePath);
    if (ext === "pdf") {
      if (openPaper.kind === "loading") return <div className="pane pane--empty">Loading…</div>;
      if (openPaper.kind === "error") {
        return (
          <div className="pane pane--empty">
            <p>This PDF cannot be opened.</p>
            <p className="pane__sub">
              <code>{openPaper.path}</code>
            </p>
            <p className="pane__sub">{openPaper.message}</p>
          </div>
        );
      }
      if (openPaper.kind === "ready") {
        return <PdfPane doc={openPaper.doc} />;
      }
      return <UnsupportedPane path={openFilePath} />;
    }
    if (ext === "typ") return <TypstPane rootId={rootId} relPath={openFilePath} />;
    // Reviewer-mode markdown: route to the MD review surface once the paper
    // row is loaded. While loading or on error, fall through to the generic
    // pane messages; writer-mode .md keeps the SourcePane + preview toggle.
    if (ext === "md" && project.kind === "reviewer") {
      if (openPaper.kind === "ready-md") {
        return (
          <MdReviewerPane
            path={openPaper.path}
            text={openPaper.text}
            paper={openPaper.paper}
            revision={openPaper.revision}
          />
        );
      }
      if (openPaper.kind === "loading") return <div className="pane pane--empty">Loading…</div>;
      if (openPaper.kind === "error") {
        return (
          <div className="pane pane--empty">
            <p>This Markdown source cannot be opened.</p>
            <p className="pane__sub">
              <code>{openPaper.path}</code>
            </p>
            <p className="pane__sub">{openPaper.message}</p>
          </div>
        );
      }
    }
    if (SOURCE_EXTS.has(ext)) return <SourcePane rootId={rootId} relPath={openFilePath} />;
    return <UnsupportedPane path={openFilePath} />;
  })();

  return (
    <>
      {absolutePath && (
        <header className="pane__path" title={absolutePath}>
          <code>{absolutePath}</code>
        </header>
      )}
      {body}
    </>
  );
}
