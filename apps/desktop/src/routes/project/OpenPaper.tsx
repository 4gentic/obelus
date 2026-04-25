import { loadDocument, MAX_PDF_BYTES, MAX_PDF_BYTES_LABEL } from "@obelus/pdf-view";
import type { PaperRow, RevisionRow } from "@obelus/repo";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { JSX } from "react";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { fsReadFile, fsStat } from "../../ipc/commands";
import { useProject } from "./context";
import { findOrCreatePaper, findPaper } from "./find-or-create-paper";
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
      // MD review surface. `paper` and `revision` are nullable: in writer
      // mode we don't eagerly create a paper row — we wait for the first
      // mark (see `MdReviewSurface.onFirstMark`). Reviewer mode still
      // materializes eagerly at open time.
      kind: "ready-md";
      path: string;
      text: string;
      paper: PaperRow | null;
      revision: RevisionRow | null;
    };

interface OpenPaperApi {
  state: OpenPaperState;
  // Re-runs the load effect for the current file. Used after lazy paper
  // creation so the state transitions from `{paper: null}` to the freshly
  // created paper + revision.
  refresh: () => void;
}

const OpenPaperContext = createContext<OpenPaperApi>({
  state: { kind: "none" },
  refresh: () => {},
});

export function OpenPaperProvider({ children }: { children: ReactNode }): JSX.Element {
  const { project, rootId, repo, openFilePath } = useProject();
  const [state, setState] = useState<OpenPaperState>({ kind: "none" });
  const [refreshTick, setRefreshTick] = useState(0);
  const refresh = useCallback(() => setRefreshTick((n) => n + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshTick is a deliberate re-fire trigger; the body doesn't read it.
  useEffect(() => {
    if (!openFilePath) {
      setState({ kind: "none" });
      return;
    }
    const ext = extensionOf(openFilePath);
    const isPdf = ext === "pdf";
    const isMd = ext === "md";
    if (!isPdf && !isMd) {
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
        if (isMd && stat.size > MAX_MD_BYTES) {
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
        if (isMd) {
          const text = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(buffer));
          // Reviewer projects eagerly materialize the paper — matches prior
          // behavior and keeps the Papers list populated. Writer projects
          // look up without creating, so MD files that have never been
          // marked stay out of the Papers section until their first mark.
          const lookup =
            project.kind === "reviewer"
              ? await findOrCreatePaper({
                  repo,
                  projectId: project.id,
                  rootId,
                  relPath: path,
                  format: "md",
                  pageCount: 0,
                })
              : await findPaper({
                  repo,
                  projectId: project.id,
                  relPath: path,
                  format: "md",
                });
          if (!cancelled) {
            setState({
              kind: "ready-md",
              path,
              text,
              paper: lookup?.paper ?? null,
              revision: lookup?.revision ?? null,
            });
          }
          return;
        }
        const doc = await loadDocument(buffer);
        const { paper, revision } = await findOrCreatePaper({
          repo,
          projectId: project.id,
          rootId,
          relPath: path,
          format: "pdf",
          pageCount: doc.numPages,
        });
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
  }, [openFilePath, project.id, project.kind, repo, rootId, refreshTick]);

  return (
    <OpenPaperContext.Provider value={{ state, refresh }}>{children}</OpenPaperContext.Provider>
  );
}

export function useOpenPaper(): OpenPaperState {
  return useContext(OpenPaperContext).state;
}

export function useRefreshOpenPaper(): () => void {
  return useContext(OpenPaperContext).refresh;
}

export function usePaperId(): string | null {
  const op = useContext(OpenPaperContext).state;
  if (op.kind === "ready") return op.paper.id;
  if (op.kind === "ready-md") return op.paper?.id ?? null;
  return null;
}
