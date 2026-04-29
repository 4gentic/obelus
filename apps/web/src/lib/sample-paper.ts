import type { AnnotationRow } from "@obelus/repo";
import { annotations, papers } from "@obelus/repo/web";

import { SAMPLE_PDF_URL, SAMPLE_SEED, SAMPLE_TITLE } from "../data/sample-annotations.generated";

const SAMPLE_PAPER_ID_KEY = "obelus.sample-paper-id";

export interface SeedResult {
  paperId: string;
  created: boolean;
}

// Idempotently makes the bundled sample paper available in the user's library.
// Re-runs (whether on first launch or via the empty-state restore link) reuse
// the existing row when it is still present, and re-create row+revision+
// annotations from the bundled assets when it is gone.
export async function seedSamplePaper(): Promise<SeedResult> {
  const existingId =
    typeof localStorage === "undefined" ? null : localStorage.getItem(SAMPLE_PAPER_ID_KEY);
  if (existingId) {
    const existing = await papers.get(existingId);
    if (existing) {
      return { paperId: existing.id, created: false };
    }
  }

  const response = await fetch(SAMPLE_PDF_URL);
  if (!response.ok) {
    throw new Error(
      `failed to load bundled sample PDF (${response.status} ${response.statusText})`,
    );
  }
  const pdfBytes = await response.arrayBuffer();

  const { paper, revision } = await papers.create({
    source: "bytes",
    title: SAMPLE_TITLE,
    pdfBytes,
  });

  const createdAt = new Date().toISOString();
  const rows: AnnotationRow[] = SAMPLE_SEED.map((seed) => ({
    id: crypto.randomUUID(),
    revisionId: revision.id,
    category: seed.category,
    quote: seed.quote,
    contextBefore: seed.contextBefore,
    contextAfter: seed.contextAfter,
    anchor: {
      kind: "pdf",
      page: seed.anchor.page,
      bbox: seed.anchor.bbox,
      textItemRange: seed.anchor.textItemRange,
      ...(seed.anchor.rects ? { rects: seed.anchor.rects } : {}),
    },
    note: seed.note,
    thread: [],
    createdAt,
  }));
  await annotations.bulkPut(revision.id, rows);

  if (typeof localStorage !== "undefined") {
    localStorage.setItem(SAMPLE_PAPER_ID_KEY, paper.id);
  }

  console.info("[ingest-sample]", {
    paperId: paper.id,
    revisionId: revision.id,
    annotationCount: rows.length,
  });

  return { paperId: paper.id, created: true };
}

export function hasBootstrappedSample(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(SAMPLE_PAPER_ID_KEY) !== null;
}
