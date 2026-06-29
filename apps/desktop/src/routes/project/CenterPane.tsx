import type { ClassifyResult } from "@obelus/html-view";
import type { PaperRow } from "@obelus/repo";
import { type JSX, useRef } from "react";
import { compileLatex, compileTypst } from "../../ipc/commands";
import { usePaperTrust } from "../../store/use-paper-trust";
import { useBuffersStore } from "./buffers-store-context";
import CenterSplitDivider from "./CenterSplitDivider";
import CompilePane from "./CompilePane";
import CompileToolbar from "./CompileToolbar";
import { useProject } from "./context";
import HtmlReviewSurface from "./HtmlReviewSurface";
import MdReviewSurface from "./MdReviewSurface";
import { useOpenPaper, useRefreshOpenPaper } from "./OpenPaper";
import { extensionOf, SOURCE_EXTS } from "./openable";
import PaperActionsMenu from "./PaperActionsMenu";
import PdfPageControls from "./PdfPageControls";
import PdfPane from "./PdfPane";
import PdfZoomControls from "./PdfZoomControls";
import SourcePane from "./SourcePane";
import { setShowSource, setSplitRatio, useSourceSplit } from "./source-split-store";
import UnsupportedPane from "./UnsupportedPane";
import { useAssetResolver } from "./use-asset-resolver";
import { useCompanionPaperId } from "./use-companion-paper";
import { useCompanionSource } from "./use-companion-source";
import { type CompileReport, useCompile } from "./use-compile";

interface CompileDispatchEntry {
  label: string;
  compile: (rootId: string, relPath: string) => Promise<CompileReport>;
  compilerToken: "typst" | "latexmk";
}

// Extension-keyed config for files that route through CompilePane (source +
// "Compile → PDF" header). The `compile` adapter normalizes the per-engine
// IPC report (LaTeX adds `engine`, Typst doesn't) down to the structural
// `CompileReport`.
const COMPILE_DISPATCH: Record<string, CompileDispatchEntry> = {
  typ: {
    label: "Typst source",
    compile: compileTypst,
    compilerToken: "typst",
  },
  tex: {
    label: "LaTeX source",
    // latexmk on PATH wins inside `compile_latex` if MacTeX/TeX Live is
    // installed; otherwise the Rust resolver falls back to managed Tectonic.
    // Either way the compiler token stays "latexmk" so the fix-compile
    // bundle's `compiler` enum value matches the auto-compile flow's.
    compile: (rootId, relPath) => compileLatex(rootId, relPath, "latexmk"),
    compilerToken: "latexmk",
  },
};

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

// The source editor beside the markable PDF. A clean compile here refreshes the
// already-open PDF in place (reanchoring marks against the new output) rather
// than swapping the open file — the editor and its undo history persist. Its
// hooks (`useCompile`, `useCompanionPaperId`) live in this child so they only
// mount when the split is on, never running for the plain-PDF path.
function SplitEditorPane({
  rootId,
  companionSource,
  cfg,
}: {
  rootId: string;
  companionSource: string;
  cfg: CompileDispatchEntry;
}): JSX.Element {
  const { repo, project } = useProject();
  const refreshOpenPaper = useRefreshOpenPaper();
  const fixPaperId = useCompanionPaperId(repo, project.id, companionSource);
  const compileState = useCompile({
    rootId,
    relPath: companionSource,
    compile: cfg.compile,
    compilerToken: cfg.compilerToken,
    fixPaperId,
    projectId: project.id,
    projectLabel: project.label,
    repo,
    onCompiled: () => refreshOpenPaper(),
  });
  return (
    <>
      <CompileToolbar label={cfg.label} compile={compileState} />
      <div className="compile-pane__editor">
        <SourcePane key={companionSource} rootId={rootId} relPath={companionSource} />
      </div>
    </>
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

function activePaperFromState(state: ReturnType<typeof useOpenPaper>): PaperRow | null {
  if (state.kind === "ready") return state.paper;
  if (state.kind === "ready-md" || state.kind === "ready-html") return state.paper;
  return null;
}

export default function CenterPane(): JSX.Element {
  const { project, openFilePath, rootId, repo } = useProject();
  const openPaper = useOpenPaper();
  const ext = openFilePath ? extensionOf(openFilePath) : "";
  const companionSource = useCompanionSource(repo, project.id, openFilePath);
  const { showSource, splitRatio } = useSourceSplit(project.id);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);

  const absolutePath = openFilePath ? `${project.root}/${openFilePath}` : null;
  const showSave = openFilePath !== null && isEditablePath(openFilePath, project.kind);
  const activePaper = activePaperFromState(openPaper);
  // Menu shows for any paper that's currently in the Reviewing list. A
  // soft-hidden paper (removedAt set) keeps its rows but hides from the
  // sidebar; suppressing the menu there matches that "out of view" stance.
  const showPaperActions = activePaper !== null && activePaper.removedAt === undefined;
  const showZoom = openPaper.kind === "ready" && activePaper !== null;
  // Writer-only, companion-gated: the toggle that slides the source editor in
  // beside the PDF. Reviewer projects and non-PDF files never see it.
  const showSourceToggle = ext === "pdf" && project.kind === "writer" && companionSource !== null;
  const companionCfg =
    companionSource !== null ? COMPILE_DISPATCH[extensionOf(companionSource)] : undefined;

  const body = ((): JSX.Element => {
    if (!openFilePath) return <UnsupportedPane path={null} />;
    if (ext === "pdf") {
      // The PDF sub-pane owns the loading/error/ready lifecycle. Scoping it
      // here (not the whole branch) keeps the source editor mounted across a
      // recompile refresh — only this side spins.
      const pdfSub = ((): JSX.Element => {
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
          return <PdfPane doc={openPaper.doc} paperId={openPaper.paper.id} />;
        }
        return <UnsupportedPane path={openFilePath} />;
      })();

      const splitOn = project.kind === "writer" && showSource && companionSource !== null;
      if (!splitOn || companionSource === null || companionCfg === undefined) {
        return pdfSub;
      }
      return (
        <div
          className="center-split"
          ref={splitContainerRef}
          style={{ gridTemplateColumns: `${splitRatio}fr 6px ${1 - splitRatio}fr` }}
        >
          <div className="center-split__editor">
            <SplitEditorPane rootId={rootId} companionSource={companionSource} cfg={companionCfg} />
          </div>
          <CenterSplitDivider
            containerRef={splitContainerRef}
            valueNow={splitRatio}
            onChange={(ratio) => setSplitRatio(project.id, ratio)}
          />
          <div className="center-split__pdf">{pdfSub}</div>
        </div>
      );
    }
    const compileCfg = COMPILE_DISPATCH[ext];
    if (compileCfg) {
      // `key` forces a clean remount per file switch — both CompilePane's
      // local compile state and SourcePane's editor are reseeded, which
      // also closes the open-on-first-click race window where stale
      // "Loading…" renders from a prior file held the host div null.
      return (
        <CompilePane key={openFilePath} rootId={rootId} relPath={openFilePath} {...compileCfg} />
      );
    }
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
    if (SOURCE_EXTS.has(ext)) {
      return <SourcePane key={openFilePath} rootId={rootId} relPath={openFilePath} />;
    }
    return <UnsupportedPane path={openFilePath} />;
  })();

  return (
    <>
      {absolutePath && (
        <header className="pane__path" title={absolutePath}>
          <code className="pane__path-code">{absolutePath}</code>
          {showSourceToggle && (
            <button
              type="button"
              className="btn btn--subtle pane__path-toggle"
              aria-pressed={showSource}
              onClick={() => setShowSource(project.id, !showSource)}
            >
              {showSource ? "Hide source" : "Show source"}
            </button>
          )}
          {showSave && openFilePath !== null && <PathHeaderSave relPath={openFilePath} />}
          {showZoom && activePaper !== null && <PdfPageControls />}
          {showZoom && activePaper !== null && <PdfZoomControls paperId={activePaper.id} />}
          {showPaperActions && activePaper !== null && <PaperActionsMenu paper={activePaper} />}
        </header>
      )}
      {body}
    </>
  );
}
