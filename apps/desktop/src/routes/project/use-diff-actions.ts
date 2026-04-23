import type { DiffHunkRow } from "@obelus/repo";
import { useCallback, useMemo } from "react";
import { applyHunks } from "../../ipc/commands";
import { autoCompileAfterDraftChange } from "./auto-compile";
import { useBuffersStore } from "./buffers-store-context";
import { buildRepassPrompt } from "./build-repass-prompt";
import { useProject } from "./context";
import { useDiffStore } from "./diff-store-context";
import { ensureBaselineEdit, snapshotAfterApply } from "./history-actions";
import { usePaperId } from "./OpenPaper";
import { useReviewRunner } from "./review-runner-context";
import { useReviewStore } from "./store-context";
import { descendantsOf, usePaperEdits } from "./use-paper-edits";

export interface ForkInfo {
  currentDraftId: string;
  currentDraftOrdinal: number;
  orphanedOrdinals: number[];
}

export interface DiffActions {
  apply: () => Promise<void>;
  repass: () => Promise<void>;
  discard: () => Promise<void>;
  // Non-null when the user is viewing an older draft than the head, so the next
  // apply will fork the DAG. UI uses this to warn before the user clicks.
  forkInfo: ForkInfo | null;
}

function effectivePatch(h: DiffHunkRow): string {
  return h.modifiedPatchText ?? h.patch;
}

export function useDiffActions(): DiffActions {
  const { repo, rootId, project, openFilePath, setOpenFilePath } = useProject();
  const paperId = usePaperId();
  const store = useDiffStore();
  const runner = useReviewRunner();
  const buffers = useBuffersStore();
  const reviewStore = useReviewStore();
  const edits = usePaperEdits(repo, paperId);

  const currentDraft = useMemo(
    () => edits.live.find((e) => e.id === edits.currentDraftId),
    [edits.live, edits.currentDraftId],
  );

  const forkInfo = useMemo<ForkInfo | null>(() => {
    if (!currentDraft || !edits.head) return null;
    if (currentDraft.id === edits.head.id) return null;
    return {
      currentDraftId: currentDraft.id,
      currentDraftOrdinal: currentDraft.ordinal,
      orphanedOrdinals: descendantsOf(edits.live, currentDraft.id).map((e) => e.ordinal),
    };
  }, [currentDraft, edits.head, edits.live]);

  const apply = useCallback(async (): Promise<void> => {
    const state = store.getState();
    const { sessionId, hunks, applyStatus } = state;
    if (!sessionId) return;
    if (applyStatus.kind === "applying") return;
    if (!paperId) {
      state.setApplyStatus({
        kind: "error",
        message: "Open a paper before applying hunks.",
      });
      return;
    }
    // A re-review is in flight — the on-screen hunks don't match the version
    // Claude is about to overwrite. Patches would apply against stale bytes.
    const runnerKind = runner.status.kind;
    if (runnerKind === "working" || runnerKind === "running" || runnerKind === "ingesting") {
      state.setApplyStatus({
        kind: "error",
        message: "A review is in flight — wait for it to finish before applying.",
      });
      return;
    }
    const dirty = buffers.getState().dirtyPaths();
    if (dirty.length > 0) {
      const first = dirty[0] ?? "";
      state.setApplyStatus({
        kind: "error",
        message:
          dirty.length === 1
            ? `Save or discard unsaved edits in ${first} first.`
            : `Save or discard unsaved edits in ${dirty.length} files first.`,
      });
      return;
    }
    const toApply = hunks.filter((h) => h.state === "accepted" || h.state === "modified");
    if (toApply.length === 0) return;
    state.setApplyStatus({ kind: "applying" });
    let stage: "baseline" | "parent-edit" | "apply-hunks" | "snapshot" | "post-apply" = "baseline";
    try {
      // Baseline captures the pre-pass tree so "restore what I started with"
      // works on a paper's first AI pass.
      await ensureBaselineEdit(repo, project.id, paperId, rootId);
      // Parent the new draft off whatever bytes are actually on disk — the
      // draft the user is viewing, not the DAG's head. If these differ,
      // snapshotAfterApply will introduce a second live leaf (a branch) and
      // the existing DAG tail sticks around as an alternate.
      stage = "parent-edit";
      const parentId = currentDraft?.id;
      const parentEdit = parentId
        ? await repo.paperEdits.get(parentId)
        : await repo.paperEdits.head(paperId);
      if (!parentEdit) {
        throw new Error("parent draft missing after ensureBaselineEdit");
      }

      const payload = toApply
        .filter((h) => h.file !== "" && effectivePatch(h) !== "")
        .map((h) => ({ file: h.file, patch: effectivePatch(h) }));
      stage = "apply-hunks";
      const report = await applyHunks({ rootId, sessionId, hunks: payload });
      stage = "snapshot";

      const draft = await snapshotAfterApply({
        repo,
        project,
        paperId,
        rootId,
        sessionId,
        parentEdit,
        landedHunks: toApply,
      });
      stage = "post-apply";

      // Working tree now matches the new draft. Keep the stored cursor in sync
      // so DraftsRail highlights the right chip and future divergence checks
      // compare against the right manifest.
      await edits.setCurrentDraftId(draft.id);
      await edits.refresh();

      await repo.reviewSessions.markApplied(sessionId);
      await repo.reviewSessions.setAppliedSnapshot(sessionId, {
        filesWritten: report.filesWritten,
        hunksApplied: report.hunksApplied,
        draftOrdinal: draft.ordinal,
      });
      console.info("[review-session]", {
        sessionId,
        status: "applied",
        filesWritten: report.filesWritten,
        hunksApplied: report.hunksApplied,
        draftOrdinal: draft.ordinal,
      });
      const touchedFiles = [...new Set(payload.map((p) => p.file))];
      await buffers.getState().refreshFromDisk(touchedFiles);
      // Reload annotations with the new draft as the ancestry root so marks
      // whose hunks just landed (stamped with resolved_in_edit_id = draft.id)
      // drop out of the active Marks tab.
      const revisionId = reviewStore.getState().revisionId;
      if (revisionId !== null) {
        await reviewStore.getState().load(revisionId, draft.id);
      }
      state.markApplied({
        filesWritten: report.filesWritten,
        hunksApplied: report.hunksApplied,
        draftOrdinal: draft.ordinal,
      });

      // Auto-compile is fire-and-forget: apply has already succeeded at this
      // point, so a slow compile must not block the UI flipping to "applied".
      // Failures surface as `compileStatus` on their own banner.
      state.setCompileStatus({ kind: "compiling" });
      const reviewedRelPath = openFilePath;
      void autoCompileAfterDraftChange({
        repo,
        rootId,
        paperId,
        trigger: "apply",
        reviewedRelPath,
      }).then((outcome) => {
        const latest = store.getState();
        switch (outcome.kind) {
          case "compiled":
            latest.setCompileStatus({
              kind: "compiled",
              outputRelPath: outcome.outputRelPath,
            });
            // Reload the viewer on the fresh PDF. When the reviewed path is
            // the compile target (the common case: `main.pdf` sibling of
            // `main.typ`), the null-then-restore forces OpenPaper's useEffect
            // to re-read the new bytes in place.
            setOpenFilePath(null);
            requestAnimationFrame(() => setOpenFilePath(outcome.outputRelPath));
            break;
          case "error":
            latest.setCompileStatus({ kind: "error", message: outcome.message });
            break;
          case "hint":
            latest.setCompileStatus({ kind: "hint", message: outcome.message });
            break;
          case "noop":
            latest.setCompileStatus({ kind: "idle" });
            break;
        }
      });
    } catch (err) {
      const detail =
        err instanceof Error ? err.message : typeof err === "string" ? err : JSON.stringify(err);
      // Tauri command errors arrive as plain strings (see AppError Serialize
      // impl in apps/desktop/src-tauri/src/error.rs) — without stringifying
      // the non-Error branch the banner would collapse to a generic "Apply
      // failed." and the user would have no way to tell a context-mismatch
      // from a missing-root from a malformed patch.
      const stageLabel: Record<typeof stage, string> = {
        baseline: "while capturing the pre-pass baseline",
        "parent-edit": "while resolving the parent draft",
        "apply-hunks": "while applying hunks to source files",
        snapshot: "while snapshotting the new draft",
        "post-apply": "after the new draft landed (compile/refresh step)",
      };
      const message = `Apply failed ${stageLabel[stage]}: ${detail}`;
      console.warn("[apply]", { sessionId, paperId, stage, detail });
      state.setApplyStatus({ kind: "error", message });
    }
  }, [
    repo,
    rootId,
    project,
    paperId,
    store,
    runner.status.kind,
    buffers,
    reviewStore,
    currentDraft,
    edits,
    openFilePath,
    setOpenFilePath,
  ]);

  const repass = useCallback(async (): Promise<void> => {
    const state = store.getState();
    const { sessionId, applyStatus } = state;
    if (!sessionId) return;
    if (applyStatus.kind === "applying") return;
    if (!paperId) {
      state.setApplyStatus({
        kind: "error",
        message: "Open a paper before repassing.",
      });
      return;
    }
    const runnerKind = runner.status.kind;
    if (runnerKind === "working" || runnerKind === "running" || runnerKind === "ingesting") {
      return;
    }
    const body = await buildRepassPrompt({ repo, sessionId });
    if (body === null) {
      state.setApplyStatus({
        kind: "error",
        message: "Nothing to push back — add a note or edit a hunk first.",
      });
      return;
    }
    await runner.start({ paperId, extraPromptBody: body });
  }, [repo, paperId, store, runner.start, runner.status.kind]);

  const discard = useCallback(async (): Promise<void> => {
    const state = store.getState();
    const { sessionId } = state;
    if (!sessionId) return;
    if (state.applyStatus.kind === "applying") return;
    try {
      await repo.reviewSessions.setStatus(sessionId, "discarded", "Dismissed by user.");
      await repo.reviewSessions.setAppliedSnapshot(sessionId, null);
      console.info("[review-session]", {
        sessionId,
        status: "discarded",
        lastError: "Dismissed by user.",
      });
      state.clear();
    } catch (err) {
      const detail =
        err instanceof Error ? err.message : typeof err === "string" ? err : JSON.stringify(err);
      console.warn("[discard]", { sessionId, detail });
      state.setApplyStatus({ kind: "error", message: `Could not discard review: ${detail}` });
    }
  }, [repo, store]);

  return { apply, repass, discard, forkInfo };
}
