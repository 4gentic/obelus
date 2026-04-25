import {
  type AnnotationV2Input,
  buildBundleV2,
  suggestBundleFilename,
} from "@obelus/bundle-builder";
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
): Promise<{ filename: string; json: string }> {
  const rows = await annotations.listForRevision(input.revision.id);
  const droppedForMissingAnchor: string[] = [];
  const v2Annotations: AnnotationV2Input[] = rows.flatMap((r) => {
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
  const bundle = buildBundleV2({
    project: {
      // Web has no multi-paper project; fold the single paper into a
      // synthetic project so the bundle validates against BundleV2.
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
    annotations: v2Annotations,
  });
  const json = JSON.stringify(bundle, null, 2);
  const filename = suggestBundleFilename("revise");
  console.info("[export-bundle-md]", {
    paperId: input.paper.id,
    annotationCount: v2Annotations.length,
    droppedForMissingAnchor,
    filename,
  });
  return { filename, json };
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
