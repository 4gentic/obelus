import type { ClassifyResult } from "@obelus/html-view";
import type { JSX } from "react";
import { usePaperTrust } from "../../store/use-paper-trust";
import { useBuffersStore } from "./buffers-store-context";
import { useProject } from "./context";
import HtmlReviewSurface from "./HtmlReviewSurface";
import MdReviewSurface from "./MdReviewSurface";
import { useOpenPaper } from "./OpenPaper";
import { extensionOf, SOURCE_EXTS } from "./openable";
import PdfPane from "./PdfPane";
import SourcePane from "./SourcePane";
import TypstPane from "./TypstPane";
import UnsupportedPane from "./UnsupportedPane";
import { useAssetResolver } from "./use-asset-resolver";

// True for files that route through `SourcePane`, which hydrates a buffer
// and exposes an editable dirty/save cycle. MD under a reviewer project
// bypasses the editor entirely (mounts `MdReviewSurface` directly), so the
// Save affordance has no buffer to reach and stays hidden.
function isEditablePath(relPath: string, projectKind: "reviewer" | "writer"): boolean {
  const ext = extensionOf(relPath);
  if (!SOURCE_EXTS.has(ext)) return false;
  if (ext === "md" && projectKind === "reviewer") return false;
  if ((ext === "html" || ext === "htm") && projectKind === "reviewer") return false;
  return true;
}

function PathHeaderSave({ relPath }: { relPath: string }): JSX.Element {
  const buffers = useBuffersStore();
  const dirty = buffers((s) => s.isDirty(relPath));
  const hasEntry = buffers((s) => s.buffers.has(relPath));
  return (
    <button
      type="button"
      className="btn btn--subtle pane__path-save"
      disabled={!dirty || !hasEntry}
      onClick={() => void buffers.getState().save(relPath)}
    >
      Save (⌘S)
    </button>
  );
}

function ReviewerHtmlMount({
  rootId,
  path,
  html,
  classification,
  paperId,
}: {
  rootId: string;
  path: string;
  html: string;
  classification: ClassifyResult;
  paperId: string | null;
}): JSX.Element {
  const assets = useAssetResolver(rootId, path);
  const { trusted, trust } = usePaperTrust(paperId);
  return (
    <HtmlReviewSurface
      path={path}
      html={html}
      classification={classification}
      assets={assets}
      trusted={trusted}
      {...(paperId ? { onTrust: trust } : {})}
    />
  );
}

function ReviewerMdMount({
  path,
  text,
  paperId,
}: {
  path: string;
  text: string;
  paperId: string | null;
}): JSX.Element {
  const { trusted, trust } = usePaperTrust(paperId);
  return (
    <MdReviewSurface
      path={path}
      text={text}
      trusted={trusted}
      {...(paperId ? { onTrust: trust } : {})}
    />
  );
}

export default function CenterPane(): JSX.Element {
  const { project, openFilePath, rootId } = useProject();
  const openPaper = useOpenPaper();

  const absolutePath = openFilePath ? `${project.root}/${openFilePath}` : null;
  const showSave = openFilePath !== null && isEditablePath(openFilePath, project.kind);

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
    // Reviewer-mode MD: skip the Source editor entirely and mount the
    // review surface directly. Writer-mode MD falls through to SourcePane,
    // whose Preview tab mounts the same review surface — writers edit and
    // mark the same file from two tabs of one pane.
    if (ext === "md" && project.kind === "reviewer") {
      if (openPaper.kind === "ready-md") {
        return (
          <ReviewerMdMount
            path={openPaper.path}
            text={openPaper.text}
            paperId={openPaper.paper?.id ?? null}
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
    // Reviewer-mode HTML: skip the editor and mount the review surface
    // directly. Writer-mode HTML falls through to SourcePane, whose Preview
    // tab mounts the same review surface against the editor's buffer.
    if ((ext === "html" || ext === "htm") && project.kind === "reviewer") {
      if (openPaper.kind === "ready-html") {
        return (
          <ReviewerHtmlMount
            rootId={rootId}
            path={openPaper.path}
            html={openPaper.html}
            classification={openPaper.classification}
            paperId={openPaper.paper?.id ?? null}
          />
        );
      }
      if (openPaper.kind === "loading") return <div className="pane pane--empty">Loading…</div>;
      if (openPaper.kind === "error") {
        return (
          <div className="pane pane--empty">
            <p>This HTML source cannot be opened.</p>
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
          <code className="pane__path-code">{absolutePath}</code>
          {showSave && openFilePath !== null && <PathHeaderSave relPath={openFilePath} />}
        </header>
      )}
      {body}
    </>
  );
}
