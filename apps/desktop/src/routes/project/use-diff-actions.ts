import type { DiffHunkRow } from "@obelus/repo";
import { useCallback } from "react";
import { applyHunks } from "../../ipc/commands";
import { useBuffersStore } from "./buffers-store-context";
import { buildRepassPrompt } from "./build-repass-prompt";
import { useProject } from "./context";
import { useDiffStore } from "./diff-store-context";
import { ensureBaselineEdit, snapshotAfterApply } from "./history-actions";
import { useReviewRunner } from "./review-runner-context";
import { useReviewStore } from "./store-context";

export interface DiffActions {
  apply: () => Promise<void>;
  repass: () => Promise<void>;
}

function effectivePatch(h: DiffHunkRow): string {
  return h.modifiedPatchText ?? h.patch;
}

export function useDiffActions(): DiffActions {
  const { repo, rootId, project } = useProject();
  const store = useDiffStore();
  const runner = useReviewRunner();
  const buffers = useBuffersStore();
  const reviewStore = useReviewStore();

  const apply = useCallback(async (): Promise<void> => {
    const state = store.getState();
    const { sessionId, hunks, applyStatus } = state;
    if (!sessionId) return;
    if (applyStatus.kind === "applying") return;
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
    try {
      // Baseline captures the pre-pass tree so "restore what I started with"
      // works on a project's first AI pass. Head is computed *after* the
      // baseline pass so first-pass parentEdit points at the baseline.
      await ensureBaselineEdit(repo, project.id, rootId);
      const parentEdit = await repo.paperEdits.head(project.id);
      if (!parentEdit) {
        throw new Error("head draft missing after ensureBaselineEdit");
      }

      const payload = toApply
        .filter((h) => h.file !== "" && effectivePatch(h) !== "")
        .map((h) => ({ file: h.file, patch: effectivePatch(h) }));
      const report = await applyHunks({ rootId, sessionId, hunks: payload });

      const draft = await snapshotAfterApply({
        repo,
        project,
        rootId,
        sessionId,
        parentEdit,
        landedHunks: toApply,
      });

      await repo.reviewSessions.markApplied(sessionId);
      const touchedFiles = [...new Set(payload.map((p) => p.file))];
      await buffers.getState().refreshFromDisk(touchedFiles);
      // Reload annotations so marks whose hunks just landed (now stamped with
      // resolved_in_edit_id) drop out of the active Marks tab.
      const revisionId = reviewStore.getState().revisionId;
      if (revisionId !== null) {
        await reviewStore.getState().load(revisionId);
      }
      state.markApplied({
        filesWritten: report.filesWritten,
        hunksApplied: report.hunksApplied,
        draftOrdinal: draft.ordinal,
      });
    } catch (err) {
      state.setApplyStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Apply failed.",
      });
    }
  }, [repo, rootId, project, store, runner.status.kind, buffers, reviewStore]);

  const repass = useCallback(async (): Promise<void> => {
    const state = store.getState();
    const { sessionId, applyStatus } = state;
    if (!sessionId) return;
    if (applyStatus.kind === "applying") return;
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
    await runner.start({ extraPromptBody: body });
  }, [repo, store, runner.start, runner.status.kind]);

  return { apply, repass };
}
