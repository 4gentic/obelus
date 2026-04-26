import type { DiffHunkRow, PaperEditRow, ProjectRow, Repository } from "@obelus/repo";
import { historySnapshot } from "../../ipc/commands";
import { autoNoteFromSession } from "./auto-note-from-session";
import { runProjectScan } from "./project-scan-actions";

// If the paper has no PaperEdit yet, snapshot the current working tree as the
// baseline so "restore to what I started with" works after the first AI pass.
// Idempotent: returns the existing baseline if one already exists.
export async function ensureBaselineEdit(
  repo: Repository,
  projectId: string,
  paperId: string,
  rootId: string,
): Promise<PaperEditRow> {
  const existing = await repo.paperEdits.baseline(paperId);
  if (existing) return existing;
  const snap = await historySnapshot({ rootId, projectId });
  return repo.paperEdits.create({
    projectId,
    paperId,
    parentEditId: null,
    kind: "baseline",
    sessionId: null,
    manifestSha256: snap.manifestSha256,
    summary: "opened as is",
    noteMd: "",
  });
}

// Captures the post-apply state of the working tree as a new AI-kind draft.
// Caller has already run `apply_hunks`; this only snapshots, creates the row,
// and archives the annotations whose hunks landed.
export async function snapshotAfterApply(args: {
  repo: Repository;
  project: ProjectRow;
  paperId: string;
  rootId: string;
  sessionId: string;
  parentEdit: PaperEditRow;
  landedHunks: ReadonlyArray<DiffHunkRow>;
}): Promise<PaperEditRow> {
  const { repo, project, paperId, rootId, sessionId, parentEdit, landedHunks } = args;
  const snap = await historySnapshot({ rootId, projectId: project.id });
  const summary = autoNoteFromSession(landedHunks);
  const draft = await repo.paperEdits.create({
    projectId: project.id,
    paperId,
    parentEditId: parentEdit.id,
    kind: "ai",
    sessionId,
    manifestSha256: snap.manifestSha256,
    summary,
    noteMd: "",
  });
  const annotationIds = Array.from(
    new Set(
      landedHunks
        .flatMap((h) => h.annotationIds)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );
  if (annotationIds.length > 0) {
    await repo.annotations.markResolvedInEdit(annotationIds, draft.id);
  }
  // Awaited (not fire-and-forget) because the caller runs auto-compile right
  // after, and auto-compile reads the `paper_build` row this scan re-seeds —
  // a stale row there silently no-ops the compile.
  await runProjectScan({
    repo,
    rootId,
    projectId: project.id,
    label: project.label,
    kind: project.kind,
  });
  return draft;
}

// Refresh the project-metadata cache after checking out a different draft.
// Exposed separately from the checkout call itself so UI code can await the
// IPC `history_checkout` first (for divergence errors) and only then trigger
// the rescan that the source-pane version rail depends on.
export async function scanAfterCheckout(args: {
  repo: Repository;
  project: ProjectRow;
  rootId: string;
}): Promise<void> {
  await runProjectScan({
    repo: args.repo,
    rootId: args.rootId,
    projectId: args.project.id,
    label: args.project.label,
    kind: args.project.kind,
  });
}
