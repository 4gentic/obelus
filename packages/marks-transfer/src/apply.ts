import type { AnnotationRow, AnnotationsRepo } from "@obelus/repo";

export type ImportMode = "replace" | "merge";

// Narrow writer surface so callers pass the real web/sqlite annotations repo.
export type MarksWriter = Pick<AnnotationsRepo, "clearForRevision" | "bulkPut">;

// Persists imported marks under the caller's chosen mode: "replace" wipes the
// revision's existing marks first, "merge" lays the imports alongside them.
export async function applyImportedMarks(
  writer: MarksWriter,
  revisionId: string,
  rows: AnnotationRow[],
  mode: ImportMode,
): Promise<void> {
  if (mode === "replace") await writer.clearForRevision(revisionId);
  await writer.bulkPut(revisionId, rows);
}
