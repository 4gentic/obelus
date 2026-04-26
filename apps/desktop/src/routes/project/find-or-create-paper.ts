import type { PaperFormat, PaperRow, Repository, RevisionRow } from "@obelus/repo";
import { fsStat } from "../../ipc/commands";

interface PaperLookupInput {
  repo: Repository;
  projectId: string;
  relPath: string;
  format: PaperFormat;
}

interface FindOrCreatePaperInput extends PaperLookupInput {
  rootId: string;
  pageCount: number;
}

// Looks up an existing paper row (+ its latest revision) for this
// (projectId, relPath, format) triple. Returns null for both when no paper
// exists yet — used by the writer-mode MD path to mount the review surface
// in "pre-first-mark" state without materializing storage rows eagerly.
//
// If the matched paper was previously soft-removed (hidden from the Reviewing
// sidebar), the act of re-opening it from disk restores it. That's the undo
// path for an accidental remove: clicking the file again brings it back. The
// returned row reflects the unhidden state.
export async function findPaper(
  input: PaperLookupInput,
): Promise<{ paper: PaperRow; revision: RevisionRow } | null> {
  const { repo, projectId, relPath, format } = input;
  const all = await repo.papers.list();
  const existing = all.find(
    (p) => p.projectId === projectId && p.pdfRelPath === relPath && p.format === format,
  );
  if (!existing) return null;
  const revisions = await repo.revisions.listForPaper(existing.id);
  const latest = revisions[revisions.length - 1];
  if (!latest) return null;
  if (existing.removedAt !== undefined) {
    await repo.papers.unhide(existing.id);
    const { removedAt: _drop, ...rest } = existing;
    return { paper: rest, revision: latest };
  }
  return { paper: existing, revision: latest };
}

// Like `findPaper`, but materializes a new PaperRow + initial RevisionRow
// when none exists. Stats the file to capture pdfSha256. Used by the
// reviewer-mode ingest path (eager) and by the writer-mode first-mark path
// (lazy, called from `MdReviewSurface`).
export async function findOrCreatePaper(
  input: FindOrCreatePaperInput,
): Promise<{ paper: PaperRow; revision: RevisionRow; created: boolean }> {
  const { repo, projectId, rootId, relPath, format, pageCount } = input;
  const found = await findPaper({ repo, projectId, relPath, format });
  if (found) return { ...found, created: false };
  const stat = await fsStat(rootId, relPath);
  const title = relPath.split("/").pop() ?? relPath;
  const result = await repo.papers.create({
    source: "ondisk",
    title,
    projectId,
    pdfRelPath: relPath,
    pdfSha256: stat.sha256,
    pageCount,
    format,
  });
  console.info("[ingest-paper]", {
    paperId: result.paper.id,
    format: result.paper.format,
    projectId,
    relPath,
    byteLength: stat.size,
    pageCount,
  });
  return { ...result, created: true };
}
