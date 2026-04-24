import { buildBundleV1, suggestBundleFilename } from "@obelus/bundle-builder";
import type { Bundle } from "@obelus/bundle-schema";
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

  return buildBundleV1({
    paper: { id: paper.id, title: paper.title },
    revision: {
      id: revision.id,
      paperId: revision.paperId,
      revisionNumber: revision.revisionNumber,
      pdfSha256: revision.pdfSha256,
      createdAt: revision.createdAt,
    },
    pdf: { filename: input.pdfFilename, pageCount: input.pageCount },
    // buildBundleV1 is PDF-specific; md-anchored rows ride the separate
    // v2 export path (see review-md flow).
    annotations: rows.filter(isPdfAnchored),
  });
}

export { suggestBundleFilename };
