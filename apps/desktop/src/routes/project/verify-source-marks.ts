import { verifySourceAnchor } from "@obelus/anchor";
import type { AnnotationRow, AnnotationStalenessPatch } from "@obelus/repo";

// Given the current source bytes for a file, verify every annotation that
// anchors into that file and return the staleness patches whose recorded
// state differs from the freshly-computed one. Callers persist these via
// `reviewStore.updateStaleness` (which writes through to the repo and
// mirrors into in-memory state).
export function verifyMarksAgainstText(
  relPath: string,
  text: string,
  annotations: ReadonlyArray<AnnotationRow>,
): AnnotationStalenessPatch[] {
  const patches: AnnotationStalenessPatch[] = [];
  for (const row of annotations) {
    if (row.anchor.kind !== "source") continue;
    if (row.anchor.file !== relPath) continue;
    const outcome = verifySourceAnchor(row.anchor, text, row.quote);
    const nextStaleness = outcome.ok ? "ok" : outcome.reason;
    const prev = row.staleness ?? "ok";
    if (prev === nextStaleness) continue;
    patches.push({ id: row.id, staleness: nextStaleness });
  }
  return patches;
}
