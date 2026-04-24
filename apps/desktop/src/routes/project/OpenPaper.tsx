import { loadDocument, MAX_PDF_BYTES, MAX_PDF_BYTES_LABEL } from "@obelus/pdf-view";
import type { PaperFormat, PaperRow, Repository, RevisionRow } from "@obelus/repo";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { JSX } from "react";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { fsReadFile, fsStat } from "../../ipc/commands";
import { useProject } from "./context";
import { extensionOf } from "./openable";

// MD papers are plain text; anything beyond this is almost certainly not a
// paper source the reviewer meant to open.
const MAX_MD_BYTES = 5 * 1024 * 1024;
const MAX_MD_BYTES_LABEL = "5 MB";

export type OpenPaperState =
  | { kind: "none" }
  | { kind: "loading"; path: string }
  | { kind: "error"; path: string; message: string }
  | {
      kind: "ready";
      path: string;
      doc: PDFDocumentProxy;
      paper: PaperRow;
      revision: RevisionRow;
    }
  | {
      kind: "ready-md";
      path: string;
      text: string;
      paper: PaperRow;
      revision: RevisionRow;
    };

const OpenPaperContext = createContext<OpenPaperState>({ kind: "none" });

async function findOrCreatePaper(
  repo: Repository,
  projectId: string,
  rootId: string,
  relPath: string,
  format: PaperFormat,
  pageCount: number,
): Promise<{ paper: PaperRow; revision: RevisionRow }> {
  const all = await repo.papers.list();
  const existing = all.find(
    (p) => p.projectId === projectId && p.pdfRelPath === relPath && p.format === format,
  );
  if (existing) {
    const revisions = await repo.revisions.listForPaper(existing.id);
    const latest = revisions[revisions.length - 1];
    if (latest) return { paper: existing, revision: latest };
  }
  const stat = await fsStat(rootId, relPath);
  const title = relPath.split("/").pop() ?? relPath;
  const result = await repo.papers.create({
    source: "ondisk",
    title,
    projectId,
    pdfRelPath: relPath,
    pdfSha256: stat.sha256,
    pageCount,
    format,
  });
  console.info("[ingest-paper]", {
    paperId: result.paper.id,
    format: result.paper.format,
    projectId,
    relPath,
    byteLength: stat.size,
    pageCount,
  });
  return result;
}

export function OpenPaperProvider({ children }: { children: ReactNode }): JSX.Element {
  const { project, rootId, repo, openFilePath } = useProject();
  const [state, setState] = useState<OpenPaperState>({ kind: "none" });

  useEffect(() => {
    if (!openFilePath) {
      setState({ kind: "none" });
      return;
    }
    const ext = extensionOf(openFilePath);
    const isPdf = ext === "pdf";
    const isMdReviewer = ext === "md" && project.kind === "reviewer";
    if (!isPdf && !isMdReviewer) {
      setState({ kind: "none" });
      return;
    }
    const path = openFilePath;
    let cancelled = false;
    setState({ kind: "loading", path });
    void (async () => {
      try {
        const stat = await fsStat(rootId, path);
        if (isPdf && stat.size > MAX_PDF_BYTES) {
          if (!cancelled) {
            setState({
              kind: "error",
              path,
              message: `That PDF is larger than ${MAX_PDF_BYTES_LABEL}. Obelus cannot open it.`,
            });
          }
          return;
        }
        if (isMdReviewer && stat.size > MAX_MD_BYTES) {
          if (!cancelled) {
            setState({
              kind: "error",
              path,
              message: `That Markdown source is larger than ${MAX_MD_BYTES_LABEL}; a paper source that big is almost certainly a mistake.`,
            });
          }
          return;
        }
        const buffer = await fsReadFile(rootId, path);
        if (isMdReviewer) {
          const text = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(buffer));
          const { paper, revision } = await findOrCreatePaper(
            repo,
            project.id,
            rootId,
            path,
            "md",
            0,
          );
          if (!cancelled) setState({ kind: "ready-md", path, text, paper, revision });
          return;
        }
        const doc = await loadDocument(buffer);
        const { paper, revision } = await findOrCreatePaper(
          repo,
          project.id,
          rootId,
          path,
          "pdf",
          doc.numPages,
        );
        if (!cancelled) setState({ kind: "ready", path, doc, paper, revision });
      } catch (err) {
        console.error("OpenPaper failed", { path, err });
        if (!cancelled) {
          const message =
            err instanceof Error
              ? err.message
              : typeof err === "string"
                ? err
                : isPdf
                  ? "This PDF cannot be opened."
                  : "This Markdown source cannot be opened.";
          setState({ kind: "error", path, message });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openFilePath, project.id, project.kind, repo, rootId]);

  return <OpenPaperContext.Provider value={state}>{children}</OpenPaperContext.Provider>;
}

export function useOpenPaper(): OpenPaperState {
  return useContext(OpenPaperContext);
}

export function usePaperId(): string | null {
  const op = useContext(OpenPaperContext);
  return op.kind === "ready" ? op.paper.id : null;
}
