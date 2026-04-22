import type { ProjectFileRow, ProjectKind, Repository } from "@obelus/repo";
import { type ProjectScanReport, projectScan } from "../../ipc/commands";

// Centralised entrypoint for walking the project, mirroring results into both
// SQLite (project_files / project_build) and `.obelus/project.json`. Callers
// are: project open, post-checkout, post-apply, and the manual Rescan action.
//
// The scanner honours an existing pinned main: the frontend passes the current
// `main_rel_path` iff `main_is_pinned = 1`, and the Rust side avoids
// overwriting it with its heuristic.

export async function runProjectScan(args: {
  repo: Repository;
  rootId: string;
  projectId: string;
  label: string;
  kind: ProjectKind;
}): Promise<ProjectScanReport> {
  const { repo, rootId, projectId, label, kind } = args;
  const existing = await repo.projectBuild.get(projectId);
  const pinnedMain = existing?.mainIsPinned ? existing.mainRelPath : null;
  const scannedAt = new Date().toISOString();

  const report = await projectScan({
    rootId,
    projectId,
    label,
    kind,
    pinnedMainRelPath: pinnedMain,
    scannedAt,
  });

  const rows: ProjectFileRow[] = report.files.map((f) => ({
    projectId,
    relPath: f.relPath,
    format: f.format,
    role: f.role,
    size: f.size,
    mtimeMs: f.mtimeMs,
    scannedAt: report.scannedAt,
  }));
  await repo.projectFiles.replaceAll(projectId, rows);

  await repo.projectBuild.upsert(projectId, {
    format: report.format,
    mainRelPath: report.mainRelPath,
    mainIsPinned: report.mainIsPinned,
    compiler: report.compiler,
    scannedAt: report.scannedAt,
  });

  return report;
}
