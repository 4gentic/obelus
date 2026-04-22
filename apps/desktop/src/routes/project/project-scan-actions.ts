import type { ProjectFileRow, ProjectKind, Repository } from "@obelus/repo";
import { type ProjectScanReport, projectScan } from "../../ipc/commands";

// Centralised entrypoint for walking the project, mirroring results into
// SQLite (project_files) and `.obelus/project.json`. Callers are: project
// open, post-checkout, post-apply, and the manual Rescan action.
//
// Build-config state is now keyed per paper (see `paper_build`). The scanner
// emits a best-guess main file + compiler at the project level — we seed
// that into any papers that don't yet have a build row, so a first pass of
// "Open a paper → Compile main" works without manual pinning. Papers with
// a user-pinned main are left alone.

export async function runProjectScan(args: {
  repo: Repository;
  rootId: string;
  projectId: string;
  label: string;
  kind: ProjectKind;
}): Promise<ProjectScanReport> {
  const { repo, rootId, projectId, label, kind } = args;

  // When any paper in this project has a pinned main, pass it to the Rust
  // scanner so the heuristic doesn't clobber a user pick. Multiple pinned
  // mains (one per paper) can't all be passed at once — we pick the first.
  const papers = await repo.papers.list();
  const projectPapers = papers.filter((p) => p.projectId === projectId);
  const pinnedMain = (async () => {
    for (const p of projectPapers) {
      const b = await repo.paperBuild.get(p.id).catch(() => undefined);
      if (b?.mainIsPinned && b.mainRelPath) return b.mainRelPath;
    }
    return null;
  })();
  const pinnedMainRelPath = await pinnedMain;
  const scannedAt = new Date().toISOString();

  const report = await projectScan({
    rootId,
    projectId,
    label,
    kind,
    pinnedMainRelPath,
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

  // Seed a per-paper build row for any paper that hasn't had one yet. Papers
  // with an existing row keep whatever the user has pinned; we only refresh
  // `scannedAt` so stale rows don't lie about age.
  for (const paper of projectPapers) {
    const existing = await repo.paperBuild.get(paper.id).catch(() => undefined);
    if (!existing) {
      await repo.paperBuild.upsert(paper.id, {
        format: report.format,
        mainRelPath: report.mainRelPath,
        mainIsPinned: false,
        compiler: report.compiler,
        scannedAt: report.scannedAt,
      });
    } else {
      await repo.paperBuild.upsert(paper.id, { scannedAt: report.scannedAt });
    }
  }

  return report;
}
