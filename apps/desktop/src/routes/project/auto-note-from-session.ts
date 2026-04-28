import type { DiffHunkRow } from "@obelus/repo";

// A pass that landed N accepted hunks across F files becomes a one-phrase
// summary used as the auto-seeded note for the resulting paper edit. The
// user can rename it later; this exists so no draft is ever labelled
// "untitled".
export function autoNoteFromSession(hunks: ReadonlyArray<DiffHunkRow>): string {
  const landed = hunks.filter((h) => h.state === "accepted" || h.state === "modified");
  if (landed.length === 0) return "no changes";

  const fileCount = new Set(landed.map((h) => h.file)).size;
  const byCategory = new Map<string, number>();
  for (const h of landed) {
    const key = h.category ?? "edit";
    byCategory.set(key, (byCategory.get(key) ?? 0) + 1);
  }

  const ordered = Array.from(byCategory.entries()).sort((a, b) => b[1] - a[1]);
  const top = ordered.slice(0, 3).map(([cat]) => phraseFor(cat));
  const phrase = top.join(", ");
  const suffix = fileCount === 1 ? "in 1 file" : `across ${fileCount} files`;
  return `${phrase} ${suffix}`;
}

function phraseFor(category: string): string {
  switch (category) {
    case "remove":
      return "removed passages";
    case "elaborate":
      return "elaborated passages";
    case "rephrase":
      return "reshaped sentences";
    case "improve":
      return "strengthened passages";
    case "wrong":
      return "corrected mistakes";
    case "weak-argument":
      return "tightened arguments";
    case "praise":
      return "kept praised passages";
    case "note":
      return "addressed notes";
    default:
      return category;
  }
}
