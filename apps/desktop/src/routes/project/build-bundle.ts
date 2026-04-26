import type { AnnotationInput, PaperRefInput, ProjectInput } from "@obelus/bundle-builder";
import { buildBundle, mapHtmlAnnotations } from "@obelus/bundle-builder";
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

export async function exportBundleForPaper(input: ExportBundleInput): Promise<ExportedBundle> {
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

  const papers: PaperRefInput[] = [
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
  // PDF). MD-anchored annotations ride a separate export in the web app.
  const pdfRows = rows.filter(isPdfAnchored);
  const annotations: AnnotationInput[] = pdfRows.map((row) => {
    const base: AnnotationInput = {
      id: row.id,
      paperId: paper.id,
      category: row.category,
      quote: row.quote,
      contextBefore: row.contextBefore,
      contextAfter: row.contextAfter,
      anchor: {
        kind: "pdf",
        page: row.anchor.page,
        bbox: row.anchor.bbox,
        textItemRange: row.anchor.textItemRange,
      },
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
        return { ...base, anchor: { kind: "source", ...resolved.span } };
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

  const projectInput: ProjectInput = {
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

  const bundle = buildBundle({
    project: projectInput,
    papers,
    annotations,
  });

  const filename = `bundle-${isoStampForFilename()}.json`;
  const json = `${JSON.stringify(bundle, null, 2)}\n`;
  return {
    filename,
    json,
    annotationCount: annotations.length,
    fileCount: papers.length,
  };
}

export interface ExportHtmlBundleInput {
  repo: Repository;
  paperId: string;
}

// HTML reviewer papers: the paper's `entrypoint` is the .html path. Anchors
// follow whichever mode classification committed at ingest — `kind: "source"`
// for paired-source HTML (where the html carried `data-src-*` markers or had
// a sibling `.md`/`.tex`/`.typ`), or one of `kind: "html"` (text run with
// char offsets) / `kind: "html-element"` (whole element addressed by xpath —
// typically an `<img>`) for hand-authored HTML. The two html-mode shapes
// coexist on the same paper by design: text selections produce `html`,
// image clicks produce `html-element`. Source-mode mixed with html-mode is
// the real classification error; we throw rather than emit a half-anchored
// bundle.
export async function exportHtmlBundleForPaper(
  input: ExportHtmlBundleInput,
): Promise<ExportedBundle> {
  const { repo, paperId } = input;
  const paper = await repo.papers.get(paperId);
  if (!paper) throw new Error("paper not found");
  if (paper.format !== "html") throw new Error("paper is not an html source");
  if (paper.projectId === undefined) throw new Error("paper has no project");
  if (paper.pdfRelPath === undefined) throw new Error("paper has no entrypoint path");
  const project = await repo.projects.get(paper.projectId);
  if (!project) throw new Error("project not found");

  const revisions = await repo.revisions.listForPaper(paper.id);
  const latest = revisions[revisions.length - 1];
  if (!latest) throw new Error("paper has no revision");

  const rows = await repo.annotations.listForRevision(latest.id);

  const { annotations, droppedForPdfAnchor, seenKinds, firstSourceFile } = mapHtmlAnnotations(
    rows,
    paper.id,
  );
  // Desktop policy: classification commits one anchor mode per paper. The
  // mode is `source` (paired-source HTML) or `html` (hand-authored HTML);
  // the latter spans both `html` and `html-element` kinds, which coexist by
  // design (text vs. element anchors on the same paper). Source-mode mixed
  // with html-mode is the real error. Web's exporter is lenient by design.
  const modes = new Set<"source" | "html">();
  for (const k of seenKinds) {
    modes.add(k === "source" ? "source" : "html");
  }
  if (modes.size > 1) {
    const kinds = [...seenKinds].join(" + ");
    throw new Error(
      `paper ${paper.id} mixes source-mode and html-mode anchors (${kinds}); classification commits one mode per paper`,
    );
  }
  const observedKind: "source" | "html" | "html-element" | null =
    seenKinds.values().next().value ?? null;

  // Mirror the web exporter: paired-source HTML points the bundle entrypoint
  // at the source file (.md/.tex/.typ) so the plugin patches source, not the
  // rendered HTML. Hand-authored HTML keeps the .html as entrypoint.
  const entrypoint = firstSourceFile ?? paper.pdfRelPath;
  const papers: PaperRefInput[] = [
    {
      id: paper.id,
      title: paper.title,
      revisionNumber: latest.revisionNumber,
      createdAt: latest.createdAt,
      entrypoint,
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

  const projectInput: ProjectInput = {
    id: project.id,
    label: project.label,
    kind: project.kind,
    categories: DEFAULT_CATEGORIES.map((c) => ({ slug: c.id, label: c.label })),
    main: entrypoint,
  };

  const bundle = buildBundle({
    project: projectInput,
    papers,
    annotations,
  });

  const filename = `bundle-${isoStampForFilename()}.json`;
  const json = `${JSON.stringify(bundle, null, 2)}\n`;
  console.info("[export-bundle-html]", {
    paperId: paper.id,
    annotationCount: annotations.length,
    anchorMode: observedKind,
    entrypoint,
    droppedForPdfAnchor,
    filename,
  });
  return {
    filename,
    json,
    annotationCount: annotations.length,
    fileCount: papers.length,
  };
}

export interface ExportMdBundleInput {
  repo: Repository;
  paperId: string;
}

// MD reviewer papers carry source anchors directly from the reviewer's
// selection; there is no PDF to resolve across, so the candidate-files hunt
// from `exportBundleForPaper` is skipped. The emitted paper has
// `entrypoint` set and no `pdf` block.
export async function exportMdBundleForPaper(input: ExportMdBundleInput): Promise<ExportedBundle> {
  const { repo, paperId } = input;
  const paper = await repo.papers.get(paperId);
  if (!paper) throw new Error("paper not found");
  if (paper.format !== "md") throw new Error("paper is not a markdown source");
  if (paper.projectId === undefined) throw new Error("paper has no project");
  if (paper.pdfRelPath === undefined) throw new Error("paper has no entrypoint path");
  const project = await repo.projects.get(paper.projectId);
  if (!project) throw new Error("project not found");

  const revisions = await repo.revisions.listForPaper(paper.id);
  const latest = revisions[revisions.length - 1];
  if (!latest) throw new Error("paper has no revision");

  const rows = await repo.annotations.listForRevision(latest.id);

  const droppedForMissingAnchor: string[] = [];
  const annotations: AnnotationInput[] = [];
  for (const row of rows) {
    if (row.anchor.kind !== "source") {
      droppedForMissingAnchor.push(row.id);
      continue;
    }
    annotations.push({
      id: row.id,
      paperId: paper.id,
      category: row.category,
      quote: row.quote,
      contextBefore: row.contextBefore,
      contextAfter: row.contextAfter,
      anchor: row.anchor,
      note: row.note,
      thread: row.thread,
      createdAt: row.createdAt,
      ...(row.groupId !== undefined ? { groupId: row.groupId } : {}),
    });
  }

  const entrypoint = paper.pdfRelPath;
  const papers: PaperRefInput[] = [
    {
      id: paper.id,
      title: paper.title,
      revisionNumber: latest.revisionNumber,
      createdAt: latest.createdAt,
      entrypoint,
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

  const projectInput: ProjectInput = {
    id: project.id,
    label: project.label,
    kind: project.kind,
    categories: DEFAULT_CATEGORIES.map((c) => ({ slug: c.id, label: c.label })),
    main: entrypoint,
  };

  const bundle = buildBundle({
    project: projectInput,
    papers,
    annotations,
  });

  const filename = `bundle-${isoStampForFilename()}.json`;
  const json = `${JSON.stringify(bundle, null, 2)}\n`;
  console.info("[export-bundle-md]", {
    paperId: paper.id,
    annotationCount: annotations.length,
    droppedForMissingAnchor,
    filename,
  });
  return {
    filename,
    json,
    annotationCount: annotations.length,
    fileCount: papers.length,
  };
}
