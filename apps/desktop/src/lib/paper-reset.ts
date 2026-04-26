import type { Repository } from "@obelus/repo";
import { workspaceRemovePaperFiles } from "../ipc/commands";
import { untrustPaper } from "../store/app-state";

export interface ResetPaperInput {
  repo: Repository;
  paperId: string;
  projectId: string;
}

export interface ResetPaperReport {
  removedFiles: number;
}

// Hard-resets a single paper. Order matters for retry semantics:
//   1. `untrustPaper` is idempotent app-state cleanup — safe to repeat.
//   2. `repo.papers.remove` is the only step that risks an inconsistent DB
//      (cascade handles revisions, annotations, paper_edits, review_sessions,
//      diff_hunks, writeups, paper_build; ask_threads.paper_id is set to
//      NULL). Doing it second-to-last means a Tauri failure on step 3 leaves
//      the row already gone — workspace cleanup can be retried by future
//      factory_reset / forgetProject without leaving orphan rows.
//   3. `workspaceRemovePaperFiles` clears paper-keyed workspace files. If
//      this fails, the row is already deleted, so the leftover files are
//      pure leak (no integrity issue) and will be reaped by any later
//      factory_reset or forgetProject cascade.
// Source files on disk are untouched.
export async function resetPaper(input: ResetPaperInput): Promise<ResetPaperReport> {
  const { repo, paperId, projectId } = input;
  await untrustPaper(paperId);
  await repo.papers.remove(paperId);
  const removedFiles = await workspaceRemovePaperFiles(projectId, paperId);
  console.info("[paper-reset]", { paperId, projectId, removedFiles });
  return { removedFiles };
}
