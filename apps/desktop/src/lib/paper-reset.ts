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

// Hard-resets a single paper: clears its `trustedPapers` flag, removes any
// paper-keyed workspace files, then deletes the row (cascade handles
// revisions, annotations, paper_edits, review_sessions, diff_hunks, writeups,
// paper_build; ask_threads.paper_id is set to NULL). The Tauri call comes
// before the SQL delete so a Tauri failure doesn't strand orphans on disk;
// app-state cleanup is first because it's the only step that's safe to
// retry. Source files on disk are untouched.
export async function resetPaper(input: ResetPaperInput): Promise<ResetPaperReport> {
  const { repo, paperId, projectId } = input;
  await untrustPaper(paperId);
  const removedFiles = await workspaceRemovePaperFiles(projectId, paperId);
  await repo.papers.remove(paperId);
  console.info("[paper-reset]", { paperId, projectId, removedFiles });
  return { removedFiles };
}
