import { buildBundle, mapHtmlAnnotations, suggestBundleFilename } from "@obelus/bundle-builder";
import type { Bundle } from "@obelus/bundle-schema";
import { DEFAULT_CATEGORIES } from "@obelus/categories";
import type { PaperRow, RevisionRow } from "@obelus/repo";
import { annotations } from "@obelus/repo/web";

type BuildInput = {
  paper: PaperRow;
  revision: RevisionRow;
  // The HTML file the paper was ingested as. Used as the bundle entrypoint
  // when the paper carries no source-anchored marks.
  htmlFile: string;
  // Set when classifyHtml() returned `mode: "source"` for this paper. The
  // bundle entrypoint then becomes the source file (.md/.tex/.typ) — Claude
  // Code patches the source, not the rendered HTML.
  sourceFile?: string;
};

// One paper per bundle. We pick a single entrypoint per paper at export time:
// when the paper was classified as paired-source we point at the source file;
// otherwise we point at the .html itself. Mixed-anchor papers fall through
// to html-mode and the source-anchored marks ride along with their own
// `anchor.file` — the bundle's `entrypoint` is a hint, not a constraint.
export async function buildHtmlBundleJson(
  input: BuildInput,
): Promise<{ filename: string; json: string; bundle: Bundle }> {
  const rows = await annotations.listForRevision(input.revision.id);
  const { annotations: bundleAnnotations, droppedForPdfAnchor: droppedForUnsupportedAnchor } =
    mapHtmlAnnotations(rows, input.paper.id);
  const entrypoint = input.sourceFile ?? input.htmlFile;
  const bundle = buildBundle({
    project: {
      id: input.paper.id,
      label: input.paper.title,
      kind: "reviewer",
      categories: DEFAULT_CATEGORIES.map((c) => ({ slug: c.id, label: c.label })),
      main: entrypoint,
    },
    papers: [
      {
        id: input.paper.id,
        title: input.paper.title,
        revisionNumber: input.revision.revisionNumber,
        createdAt: input.revision.createdAt,
        entrypoint,
        ...(input.paper.rubric !== undefined
          ? {
              rubric: {
                body: input.paper.rubric.body,
                label: input.paper.rubric.label,
                source: input.paper.rubric.source,
              },
            }
          : {}),
      },
    ],
    annotations: bundleAnnotations,
  });
  const json = JSON.stringify(bundle, null, 2);
  const filename = suggestBundleFilename("revise");
  console.info("[export-bundle-html]", {
    paperId: input.paper.id,
    annotationCount: bundleAnnotations.length,
    droppedForUnsupportedAnchor,
    entrypoint,
    mode: input.sourceFile !== undefined ? "source" : "html",
    filename,
  });
  return { filename, json, bundle };
}

export async function downloadHtmlBundle(
  input: BuildInput,
  kind: "review" | "revise",
): Promise<string | null> {
  const { json } = await buildHtmlBundleJson(input);
  const filename = suggestBundleFilename(kind);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return filename;
}
