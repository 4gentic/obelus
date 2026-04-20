import type { JSX } from "react";
import { useProject } from "./context";
import { useOpenPaper } from "./OpenPaper";
import { extensionOf, SOURCE_EXTS } from "./openable";
import PdfPane from "./PdfPane";
import SourcePane from "./SourcePane";
import TypstPane from "./TypstPane";
import UnsupportedPane from "./UnsupportedPane";
import { useSelectionHandler } from "./use-selection";
export default function CenterPane(): JSX.Element {
  const { openFilePath, rootId } = useProject();
  const openPaper = useOpenPaper();
  const onAnchor = useSelectionHandler(openPaper.kind === "ready" ? openPaper.doc : null);

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
      return <PdfPane doc={openPaper.doc} onAnchor={onAnchor} />;
    }
    return <UnsupportedPane path={openFilePath} />;
  }

  if (ext === "typ") {
    return <TypstPane rootId={rootId} relPath={openFilePath} />;
  }

  if (SOURCE_EXTS.has(ext)) {
    return <SourcePane rootId={rootId} relPath={openFilePath} />;
  }
  return <UnsupportedPane path={openFilePath} />;
}
