import type { AnnotationV2Input, PaperRefV2Input, ProjectV2Input } from "@obelus/bundle-builder";
import { buildBundleV2 } from "@obelus/bundle-builder";
import { DEFAULT_CATEGORIES } from "@obelus/categories";
import type { Repository } from "@obelus/repo";

export interface ExportBundleInput {
  repo: Repository;
  projectId: string;
}

export interface ExportedBundle {
  filename: string;
  json: string;
  annotationCount: number;
  fileCount: number;
}

function isoStampForFilename(now: Date = new Date()): string {
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

export async function exportBundleV2ForProject(input: ExportBundleInput): Promise<ExportedBundle> {
  const { repo, projectId } = input;
  const project = await repo.projects.get(projectId);
  if (!project) throw new Error("project not found");

  const allPapers = await repo.papers.list();
  const projectPapers = allPapers.filter(
    (p) => p.projectId === projectId && p.pdfRelPath !== undefined && p.pageCount !== undefined,
  );
  if (projectPapers.length === 0) {
    throw new Error("no papers in this project yet");
  }

  const papers: PaperRefV2Input[] = [];
  const annotations: AnnotationV2Input[] = [];

  for (const paper of projectPapers) {
    const revisions = await repo.revisions.listForPaper(paper.id);
    const latest = revisions[revisions.length - 1];
    if (!latest) continue;
    if (paper.pdfRelPath === undefined || paper.pageCount === undefined) continue;
    papers.push({
      id: paper.id,
      title: paper.title,
      revisionNumber: latest.revisionNumber,
      createdAt: latest.createdAt,
      pdfRelPath: paper.pdfRelPath,
      pdfSha256: paper.pdfSha256,
      pageCount: paper.pageCount,
      ...(paper.rubric !== undefined
        ? {
            rubric: {
              body: paper.rubric.body,
              label: paper.rubric.label,
              source: paper.rubric.source,
            },
          }
        : {}),
    });
    const rows = await repo.annotations.listForRevision(latest.id);
    for (const row of rows) {
      annotations.push({
        id: row.id,
        paperId: paper.id,
        category: row.category,
        quote: row.quote,
        contextBefore: row.contextBefore,
        contextAfter: row.contextAfter,
        page: row.page,
        bbox: row.bbox,
        textItemRange: row.textItemRange,
        note: row.note,
        thread: row.thread,
        createdAt: row.createdAt,
        ...(row.groupId !== undefined ? { groupId: row.groupId } : {}),
      });
    }
  }

  if (annotations.length === 0) {
    throw new Error("no annotations to review");
  }

  // Cached project-tree hints: the plugin reuses these to skip discovery.
  // Absent fields (e.g. the scan hasn't run yet) leave the plugin's existing
  // heuristics as the fallback path.
  const [projectBuild, projectFiles] = await Promise.all([
    repo.projectBuild.get(projectId).catch(() => undefined),
    repo.projectFiles.listForProject(projectId).catch(() => []),
  ]);

  const projectInput: ProjectV2Input = {
    id: project.id,
    label: project.label,
    kind: project.kind,
    categories: DEFAULT_CATEGORIES.map((c) => ({
      slug: c.id,
      label: c.label,
    })),
    ...(projectBuild?.mainRelPath ? { main: projectBuild.mainRelPath } : {}),
    ...(projectFiles.length > 0
      ? {
          files: projectFiles
            .filter((f) => f.format !== "pdf")
            .map((f) => ({
              relPath: f.relPath,
              format: f.format,
              ...(f.role !== null ? { role: f.role } : {}),
            })),
        }
      : {}),
  };

  const bundle = buildBundleV2({
    project: projectInput,
    papers,
    annotations,
  });

  const filename = `.obelus/bundle-${isoStampForFilename()}.json`;
  const json = `${JSON.stringify(bundle, null, 2)}\n`;
  return {
    filename,
    json,
    annotationCount: annotations.length,
    fileCount: papers.length,
  };
}
