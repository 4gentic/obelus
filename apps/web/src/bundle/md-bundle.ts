import { type AnnotationInput, buildBundle, suggestBundleFilename } from "@obelus/bundle-builder";
import type { Bundle } from "@obelus/bundle-schema";
import { DEFAULT_CATEGORIES } from "@obelus/categories";
import type { PaperRow, RevisionRow } from "@obelus/repo";
import { annotations } from "@obelus/repo/web";

type BuildInput = {
  paper: PaperRow;
  revision: RevisionRow;
  file: string;
};

export async function buildMdBundleJson(
  input: BuildInput,
): Promise<{ filename: string; json: string; bundle: Bundle }> {
  const rows = await annotations.listForRevision(input.revision.id);
  const droppedForMissingAnchor: string[] = [];
  const bundleAnnotations: AnnotationInput[] = rows.flatMap((r) => {
    if (r.anchor.kind !== "source") {
      droppedForMissingAnchor.push(r.id);
      return [];
    }
    return [
      {
        id: r.id,
        paperId: input.paper.id,
        category: r.category,
        quote: r.quote,
        contextBefore: r.contextBefore,
        contextAfter: r.contextAfter,
        anchor: r.anchor,
        note: r.note,
        thread: r.thread,
        createdAt: r.createdAt,
        ...(r.groupId !== undefined ? { groupId: r.groupId } : {}),
      },
    ];
  });
  const bundle = buildBundle({
    project: {
      // Web has no multi-paper project; fold the single paper into a synthetic
      // project so the bundle validates.
      id: input.paper.id,
      label: input.paper.title,
      kind: "reviewer",
      categories: DEFAULT_CATEGORIES.map((c) => ({ slug: c.id, label: c.label })),
      main: input.file,
    },
    papers: [
      {
        id: input.paper.id,
        title: input.paper.title,
        revisionNumber: input.revision.revisionNumber,
        createdAt: input.revision.createdAt,
        entrypoint: input.file,
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
  console.info("[export-bundle-md]", {
    paperId: input.paper.id,
    annotationCount: bundleAnnotations.length,
    droppedForMissingAnchor,
    filename,
  });
  return { filename, json, bundle };
}

export async function downloadMdBundle(
  input: BuildInput,
  kind: "review" | "revise",
): Promise<string | null> {
  const { json } = await buildMdBundleJson(input);
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
