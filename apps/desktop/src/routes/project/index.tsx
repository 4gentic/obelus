import type { ProjectRow, Repository } from "@obelus/repo";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { authorizeProjectRoot, fsListPdfs } from "../../ipc/commands";
import { getRepository } from "../../lib/repo";
import { AskStoreProvider } from "./ask-store-context";
import { BuffersStoreProvider } from "./buffers-store-context";
import { ProjectProvider } from "./context";
import { DiffStoreProvider } from "./diff-store-context";
import { OpenPaperProvider } from "./OpenPaper";
import ProjectShell from "./ProjectShell";
import { ReviewRunnerProvider } from "./review-runner";
import { ReviewStoreProvider } from "./store-context";
import { WriteUpStoreProvider } from "./writeup-store-context";
import "./project.css";

import type { JSX } from "react";

type LoadState =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error"; message: string }
  | { kind: "ready"; project: ProjectRow; rootId: string; repo: Repository };

export default function ProjectRoute(): JSX.Element {
  const { id } = useParams();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [openFilePath, setOpenFilePath] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setState({ kind: "error", message: "Project id missing in URL." });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const repo = await getRepository();
        const project = await repo.projects.get(id);
        if (!project) {
          if (!cancelled) setState({ kind: "missing" });
          return;
        }
        const rootId = await authorizeProjectRoot(project.root);
        await repo.projects.touchLastOpened(id);
        const stored = project.lastOpenedFilePath;
        if (stored) {
          if (!cancelled) setOpenFilePath(stored);
        } else if (project.kind === "reviewer") {
          const pdfs = await fsListPdfs(rootId);
          const first = pdfs[0];
          if (first && !cancelled) {
            setOpenFilePath(first);
            void repo.projects.setLastOpenedFile(project.id, first);
          }
        }
        if (!cancelled) setState({ kind: "ready", project, rootId, repo });
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: "error",
            message: err instanceof Error ? err.message : "Could not open project.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleSetOpen = useCallback(
    (path: string | null) => {
      setOpenFilePath(path);
      if (path !== null && state.kind === "ready") {
        void state.repo.projects.setLastOpenedFile(state.project.id, path);
      }
    },
    [state],
  );

  if (state.kind === "loading") return <p className="pane pane--empty">Opening…</p>;
  if (state.kind === "missing") {
    return (
      <div className="pane pane--empty">
        <p>Project not found.</p>
        <Link to="/home">Back to home</Link>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="pane pane--empty">
        <p>{state.message}</p>
        <Link to="/home">Back to home</Link>
      </div>
    );
  }

  return (
    <ProjectProvider
      value={{
        project: state.project,
        rootId: state.rootId,
        repo: state.repo,
        openFilePath,
        setOpenFilePath: handleSetOpen,
      }}
    >
      <BuffersStoreProvider>
        <ReviewStoreProvider>
          <DiffStoreProvider>
            <AskStoreProvider>
              <WriteUpStoreProvider>
                <ReviewRunnerProvider>
                  <OpenPaperProvider>
                    <ProjectShell />
                  </OpenPaperProvider>
                </ReviewRunnerProvider>
              </WriteUpStoreProvider>
            </AskStoreProvider>
          </DiffStoreProvider>
        </ReviewStoreProvider>
      </BuffersStoreProvider>
    </ProjectProvider>
  );
}
