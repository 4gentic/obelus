import type { Repository } from "@obelus/repo";
import { workspaceDelete } from "../ipc/commands";
import { untrustPapers } from "../store/app-state";

export interface ResetProjectInput {
  repo: Repository;
  projectId: string;
}

export interface ResetProjectReport {
  paperCount: number;
}

// Hard-resets every paper inside a project while keeping the project row
// (label, desk membership, pin state) intact. SQL: deletes papers by
// project_id (cascade handles dependents) and ask_threads scoped to the
// project. Filesystem: nukes the project's workspace dir. App-state: drops
// every `trustedPapers` entry for the papers that were resident at reset.
// Source files under the project's root on disk are untouched.
export async function resetProject(input: ResetProjectInput): Promise<ResetProjectReport> {
  const { repo, projectId } = input;
  const { paperIds } = await repo.projects.reset(projectId);
  await untrustPapers(paperIds);
  await workspaceDelete(projectId);
  console.info("[project-reset]", { projectId, paperCount: paperIds.length });
  return { paperCount: paperIds.length };
}
