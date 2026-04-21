import {
  type ClaudeStreamEvent,
  claudeCancel,
  claudeDraftWriteup,
  onClaudeExit,
  onClaudeStderr,
  onClaudeStdout,
} from "@obelus/claude-sidecar";
import {
  createContext,
  type JSX,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
} from "react";
import { fsWriteBytes, fsWriteText } from "../../ipc/commands";
import { createWriteUpStore, type WriteUpStore } from "../../lib/writeup-store";
import { exportBundleV2ForProject } from "./build-bundle";
import { useProject } from "./context";

export interface WriteUpRunner {
  store: WriteUpStore;
  beginDraft(paperId: string, paperTitle: string): Promise<void>;
  cancelDraft(): Promise<void>;
}

const WriteUpRunnerContext = createContext<WriteUpRunner | null>(null);

export function WriteUpStoreProvider({ children }: { children: ReactNode }): JSX.Element {
  const { project, repo, rootId } = useProject();
  const store = useMemo(() => createWriteUpStore(repo.writeUps), [repo]);

  useEffect(() => {
    // `onClaude*` are async: if the effect re-runs (HMR, store memo invalidation,
    // remount) before the first `.then` resolves, cleanup sees `unlisten*` still
    // null and the first listener stays alive — producing a doubled stream. The
    // `cancelled` flag + in-callback guard keeps a single live sink regardless
    // of when the registration promises resolve.
    let cancelled = false;
    let unlistenStdout: (() => void) | null = null;
    let unlistenStderr: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;

    const matchSession = (sid: string): boolean => {
      const s = store.getState().status;
      return s.kind === "streaming" && s.claudeSessionId === sid;
    };

    void onClaudeStdout((ev: ClaudeStreamEvent) => {
      if (cancelled) return;
      if (!matchSession(ev.sessionId)) return;
      store.getState().appendChunk(ev.line);
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenStdout = fn;
    });

    void onClaudeStderr((ev: ClaudeStreamEvent) => {
      if (cancelled) return;
      void ev;
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenStderr = fn;
    });

    void onClaudeExit((ev) => {
      if (cancelled) return;
      if (!matchSession(ev.sessionId)) return;
      if (ev.cancelled) {
        void store.getState().finishDrafting({ cancelled: true });
        return;
      }
      if (ev.code !== 0) {
        store.getState().failDrafting(`Claude exited with code ${ev.code ?? "?"}.`);
        return;
      }
      void store.getState().finishDrafting();
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenExit = fn;
    });

    return () => {
      cancelled = true;
      unlistenStdout?.();
      unlistenStderr?.();
      unlistenExit?.();
    };
  }, [store]);

  const beginDraft = useCallback(
    async (paperId: string, paperTitle: string): Promise<void> => {
      try {
        const { filename, json } = await exportBundleV2ForProject({ repo, projectId: project.id });
        const bytes = new TextEncoder().encode(json);
        await fsWriteBytes(rootId, filename, bytes);
        const paper = await repo.papers.get(paperId);
        let rubricRelPath: string | undefined;
        if (paper?.rubric) {
          rubricRelPath = `.obelus/rubric-${paperId}.md`;
          await fsWriteText(rootId, rubricRelPath, paper.rubric.body);
        }
        const claudeSessionId = await claudeDraftWriteup({
          rootId,
          bundleRelPath: filename,
          paperId,
          paperTitle,
          ...(rubricRelPath !== undefined ? { rubricRelPath } : {}),
        });
        await store.getState().load(project.id, paperId);
        store.getState().startDrafting(claudeSessionId);
      } catch (err) {
        store
          .getState()
          .failDrafting(err instanceof Error ? err.message : "Could not start write-up.");
      }
    },
    [repo, project.id, rootId, store],
  );

  const cancelDraft = useCallback(async (): Promise<void> => {
    const s = store.getState().status;
    if (s.kind !== "streaming") return;
    await claudeCancel(s.claudeSessionId);
  }, [store]);

  const value: WriteUpRunner = useMemo(
    () => ({ store, beginDraft, cancelDraft }),
    [store, beginDraft, cancelDraft],
  );

  return <WriteUpRunnerContext.Provider value={value}>{children}</WriteUpRunnerContext.Provider>;
}

export function useWriteUpRunner(): WriteUpRunner {
  const ctx = useContext(WriteUpRunnerContext);
  if (!ctx) throw new Error("useWriteUpRunner requires WriteUpStoreProvider");
  return ctx;
}

export function useWriteUpStore(): WriteUpStore {
  return useWriteUpRunner().store;
}
