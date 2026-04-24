import { loadDocument, MAX_PDF_BYTES, MAX_PDF_BYTES_LABEL } from "@obelus/pdf-view";
import type { PaperRow, Repository, RevisionRow } from "@obelus/repo";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { JSX } from "react";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { fsReadFile, fsStat } from "../../ipc/commands";
import { useProject } from "./context";
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
    };

const OpenPaperContext = createContext<OpenPaperState>({ kind: "none" });

async function findOrCreatePaper(
  repo: Repository,
  projectId: string,
  rootId: string,
  relPath: string,
  pageCount: number,
): Promise<{ paper: PaperRow; revision: RevisionRow }> {
  const all = await repo.papers.list();
  const existing = all.find((p) => p.projectId === projectId && p.pdfRelPath === relPath);
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
  });
  console.info("[ingest-paper]", {
    paperId: result.paper.id,
    format: result.paper.format,
    projectId,
    relPath,
    pageCount,
  });
  return result;
}

export function OpenPaperProvider({ children }: { children: ReactNode }): JSX.Element {
  const { project, rootId, repo, openFilePath } = useProject();
  const [state, setState] = useState<OpenPaperState>({ kind: "none" });

  useEffect(() => {
    if (!openFilePath?.toLowerCase().endsWith(".pdf")) {
      setState({ kind: "none" });
      return;
    }
    const path = openFilePath;
    let cancelled = false;
    setState({ kind: "loading", path });
    void (async () => {
      try {
        const stat = await fsStat(rootId, path);
        if (stat.size > MAX_PDF_BYTES) {
          if (!cancelled) {
            setState({
              kind: "error",
              path,
              message: `That PDF is larger than ${MAX_PDF_BYTES_LABEL}. Obelus cannot open it.`,
            });
          }
          return;
        }
        const buffer = await fsReadFile(rootId, path);
        const doc = await loadDocument(buffer);
        const { paper, revision } = await findOrCreatePaper(
          repo,
          project.id,
          rootId,
          path,
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
                : "This PDF cannot be opened.";
          setState({ kind: "error", path, message });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openFilePath, project.id, repo, rootId]);

  return <OpenPaperContext.Provider value={state}>{children}</OpenPaperContext.Provider>;
}

export function useOpenPaper(): OpenPaperState {
  return useContext(OpenPaperContext);
}

export function usePaperId(): string | null {
  const op = useContext(OpenPaperContext);
  return op.kind === "ready" ? op.paper.id : null;
}
