import type { AnnotationRow, AnnotationsRepo } from "@obelus/repo";

export type ImportMode = "replace" | "merge";

// Narrow writer surface so callers pass the real web/sqlite annotations repo.
export type MarksWriter = Pick<AnnotationsRepo, "replaceForRevision" | "bulkPut">;

// Persists imported marks under the caller's chosen mode. "replace" swaps the
// revision's marks atomically — delete and write ride one transaction, so a
// failed import can't leave the reviewer with neither their old marks nor the
// imported ones. "merge" lays the imports alongside what's already there.
export async function applyImportedMarks(
  writer: MarksWriter,
  revisionId: string,
  rows: AnnotationRow[],
  mode: ImportMode,
): Promise<void> {
  if (mode === "replace") {
    await writer.replaceForRevision(revisionId, rows);
  } else {
    await writer.bulkPut(revisionId, rows);
  }
}
