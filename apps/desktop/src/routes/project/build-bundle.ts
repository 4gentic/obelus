import type { AnnotationV2Input, PaperRefV2Input, ProjectV2Input } from "@obelus/bundle-builder";
import { buildBundleV2 } from "@obelus/bundle-builder";
import { DEFAULT_CATEGORIES } from "@obelus/categories";
import { isPdfAnchored, type ProjectFileRow, type Repository } from "@obelus/repo";
import { fsReadFile } from "../../ipc/commands";
import { resolveAcrossFiles } from "./resolveSourceAnchors";

// Source file formats the pre-resolver can index. PDFs and binaries are
// excluded upstream; this keeps the candidate set to searchable text.
const SOURCE_FORMATS = new Set(["typ", "tex", "md"]);

function dirnameOf(relPath: string): string {
  const i = relPath.lastIndexOf("/");
  return i < 0 ? "" : relPath.slice(0, i);
}

// Candidate source files to try when the paper's `mainRelPath` either isn't
// set or doesn't contain the quote. Scoped to siblings of the paper's PDF —
// the common split-document layout puts `paper/short/main.typ` alongside
// `00-abstract.typ` ... `09-conclusion.typ`, and the quote lives in one of
// them. Tight scoping keeps noise out (avoids matching a stray phrase in an
// unrelated `paper/notes/literature/*.md`) and keeps the scan fast (~10–30
// files, a few hundred KB total).
export function selectSiblingSourceCandidates(
  projectFiles: ReadonlyArray<Pick<ProjectFileRow, "relPath" | "format">>,
  pdfRelPath: string,
  skipRelPath: string | undefined,
): string[] {
  const pdfDir = dirnameOf(pdfRelPath);
  return projectFiles
    .filter(
      (f) =>
        SOURCE_FORMATS.has(f.format) &&
        dirnameOf(f.relPath) === pdfDir &&
        f.relPath !== skipRelPath,
    )
    .map((f) => f.relPath);
}

interface LoadedSource {
  relPath: string;
  text: string;
}

async function loadSources(rootId: string, relPaths: readonly string[]): Promise<LoadedSource[]> {
  const loaded = await Promise.all(
    relPaths.map(async (relPath): Promise<LoadedSource | null> => {
      try {
        const buf = await fsReadFile(rootId, relPath);
        return { relPath, text: new TextDecoder().decode(buf) };
      } catch {
        return null;
      }
    }),
  );
  return loaded.filter((x): x is LoadedSource => x !== null);
}

export interface ExportBundleInput {
  repo: Repository;
  paperId: string;
  // When provided, annotations whose quote resolves unambiguously to the
  // paper's main source file are upgraded from `pdf` to `source` anchors so
  // the plugin skips its Grep/Read fuzzy-match hunt.
  rootId?: string;
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

export async function exportBundleV2ForPaper(input: ExportBundleInput): Promise<ExportedBundle> {
  const { repo, paperId, rootId } = input;
  const paper = await repo.papers.get(paperId);
  if (!paper) throw new Error("paper not found");
  if (paper.projectId === undefined) throw new Error("paper has no project");
  if (paper.pdfRelPath === undefined || paper.pageCount === undefined) {
    throw new Error("paper has no PDF artifact yet");
  }
  const project = await repo.projects.get(paper.projectId);
  if (!project) throw new Error("project not found");

  const revisions = await repo.revisions.listForPaper(paper.id);
  const latest = revisions[revisions.length - 1];
  if (!latest) throw new Error("paper has no revision");

  const rows = await repo.annotations.listForRevision(latest.id);
  if (rows.length === 0) {
    throw new Error("no annotations to review");
  }

  const papers: PaperRefV2Input[] = [
    {
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
    },
  ];

  // Cached project-tree + per-paper build hints: the plugin reuses these to
  // skip discovery. Absent fields leave the plugin's existing heuristics as
  // the fallback path.
  const [paperBuild, projectFiles] = await Promise.all([
    repo.paperBuild.get(paper.id).catch(() => undefined),
    repo.projectFiles.listForProject(project.id).catch(() => []),
  ]);

  const mainRelPath = paperBuild?.mainRelPath ?? undefined;
  // Candidates, in priority order:
  //   1. `mainRelPath` (the paper's declared entrypoint, when known)
  //   2. PDF-sibling source files from `project.files`
  // Siblings cover the common split-document case where `mainRelPath` is
  // either unset or is an entrypoint that `#include`s the files actually
  // holding the prose (so the quote is never in `main.typ` itself).
  const siblingRelPaths = selectSiblingSourceCandidates(
    projectFiles,
    paper.pdfRelPath,
    mainRelPath,
  );
  const candidateRelPaths =
    mainRelPath !== undefined ? [mainRelPath, ...siblingRelPaths] : siblingRelPaths;
  const candidates: LoadedSource[] =
    rootId !== undefined ? await loadSources(rootId, candidateRelPaths) : [];

  const resolutionsByFile = new Map<string, number>();
  let resolvedCount = 0;
  // This flow is PDF-paper-driven (writer project reviewing their compiled
  // PDF). MD-anchored annotations ride a separate v2 export in the web app.
  const pdfRows = rows.filter(isPdfAnchored);
  const annotations: AnnotationV2Input[] = pdfRows.map((row) => {
    const base: AnnotationV2Input = {
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
    };
    if (candidates.length > 0) {
      const resolved = resolveAcrossFiles(candidates, {
        quote: row.quote,
        contextBefore: row.contextBefore,
        contextAfter: row.contextAfter,
      });
      if (resolved.kind === "resolved" && resolved.span !== undefined) {
        resolvedCount += 1;
        resolutionsByFile.set(
          resolved.span.file,
          (resolutionsByFile.get(resolved.span.file) ?? 0) + 1,
        );
        return { ...base, sourceAnchor: resolved.span };
      }
    }
    return base;
  });

  console.info("[export-bundle]", {
    paperId: paper.id,
    annotationCount: annotations.length,
    sourceAnchorsResolved: resolvedCount,
    mainRelPath: mainRelPath ?? null,
    candidatesScanned: candidates.length,
    resolutionsByFile: Object.fromEntries(resolutionsByFile),
  });

  const projectInput: ProjectV2Input = {
    id: project.id,
    label: project.label,
    kind: project.kind,
    categories: DEFAULT_CATEGORIES.map((c) => ({
      slug: c.id,
      label: c.label,
    })),
    ...(paperBuild?.mainRelPath ? { main: paperBuild.mainRelPath } : {}),
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
