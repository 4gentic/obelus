import {
  type AnnotationInput,
  buildBundle as build,
  suggestBundleFilename,
} from "@obelus/bundle-builder";
import type { Bundle } from "@obelus/bundle-schema";
import { DEFAULT_CATEGORIES } from "@obelus/categories";
import { isPdfAnchored } from "@obelus/repo";
import { annotations, papers, revisions } from "@obelus/repo/web";

export interface BuildInput {
  paperId: string;
  revisionId: string;
  pdfFilename: string;
  pageCount: number;
}

export async function buildBundle(input: BuildInput): Promise<Bundle> {
  const paper = await papers.get(input.paperId);
  if (!paper) throw new Error(`paper not found: ${input.paperId}`);
  const revision = await revisions.get(input.revisionId);
  if (!revision) throw new Error(`revision not found: ${input.revisionId}`);
  const rows = await annotations.listForRevision(revision.id);

  const v2Annotations: AnnotationInput[] = rows.filter(isPdfAnchored).map((r) => ({
    id: r.id,
    paperId: paper.id,
    category: r.category,
    quote: r.quote,
    contextBefore: r.contextBefore,
    contextAfter: r.contextAfter,
    anchor: {
      kind: "pdf",
      page: r.anchor.page,
      bbox: r.anchor.bbox,
      textItemRange: r.anchor.textItemRange,
    },
    note: r.note,
    thread: r.thread,
    createdAt: r.createdAt,
    ...(r.groupId !== undefined ? { groupId: r.groupId } : {}),
  }));

  return build({
    project: {
      // Web has no multi-paper project; fold the single paper into a synthetic
      // project so the bundle validates.
      id: paper.id,
      label: paper.title,
      kind: "reviewer",
      categories: DEFAULT_CATEGORIES.map((c) => ({ slug: c.id, label: c.label })),
      main: input.pdfFilename,
    },
    papers: [
      {
        id: paper.id,
        title: paper.title,
        revisionNumber: revision.revisionNumber,
        createdAt: revision.createdAt,
        pdfRelPath: input.pdfFilename,
        pdfSha256: revision.pdfSha256,
        pageCount: input.pageCount,
        entrypoint: input.pdfFilename,
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
    ],
    annotations: v2Annotations,
  });
}

export { suggestBundleFilename };
