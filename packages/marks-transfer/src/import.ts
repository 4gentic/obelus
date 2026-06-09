import type { Anchor, MarksArchive, MarksArchiveMark } from "@obelus/bundle-schema";
import type { AnchorFields, AnnotationRow, AnnotationStaleness, PaperFormat } from "@obelus/repo";

export type ImportHashMatch = "exact" | "mismatch" | "format-mismatch";

// Re-locates a mark's anchor against the *current* target document. Returns the
// rebuilt anchor, or null when the mark's text can't be found (kept + flagged,
// never dropped). Injected so this module stays free of pdfjs/DOM.
export type ReanchorFn = (mark: MarksArchiveMark) => Promise<AnchorFields | null>;

export interface ImportReport {
  hashMatch: ImportHashMatch;
  // Anchored verbatim (exact-hash path).
  matched: number;
  // Hash differed but the quote was re-located, anchor rebuilt.
  reanchored: number;
  // Hash differed and the quote couldn't be re-located; kept with
  // `staleness: "quote-mismatch"`.
  flagged: number;
  // Dropped because the anchor kind can't apply to the target format.
  skipped: number;
  // Category slugs present on imported marks but absent from the target
  // project (kept as-is, surfaced for the caller — never coerced or dropped).
  unknownCategories: string[];
  // New row ids of flagged marks, and original archive ids of dropped marks.
  flaggedIds: string[];
  droppedIds: string[];
  message: string;
}

export interface ImportMarksArchiveInput {
  archive: MarksArchive;
  targetRevisionId: string;
  targetPdfSha256: string;
  targetFormat: PaperFormat;
  targetCategorySlugs: ReadonlySet<string>;
  // Absent on surfaces that can't re-anchor (MD/HTML today); a hash mismatch
  // then flags every mark rather than rebuilding it.
  reanchor?: ReanchorFn;
  newId: () => string;
}

export interface ImportMarksArchiveResult {
  rows: AnnotationRow[];
  report: ImportReport;
}

function anchorAppliesToFormat(anchor: Anchor, format: PaperFormat): boolean {
  switch (format) {
    case "pdf":
      return anchor.kind === "pdf";
    case "md":
      return anchor.kind === "source";
    case "html":
      return anchor.kind === "html" || anchor.kind === "html-element";
  }
}

const plural = (n: number): string => (n === 1 ? "" : "s");

function buildMessage(p: {
  hashMatch: ImportHashMatch;
  total: number;
  matched: number;
  reanchored: number;
  flagged: number;
  skipped: number;
  unknownCount: number;
  sourceFormat: PaperFormat;
  targetFormat: PaperFormat;
}): string {
  if (p.total === 0) return "This archive has no marks.";

  if (p.hashMatch === "format-mismatch") {
    const imported = p.total - p.skipped;
    if (imported === 0) {
      return `Cannot import: this archive is for a ${p.sourceFormat} paper, but this paper is ${p.targetFormat}.`;
    }
    return `This archive is for a ${p.sourceFormat} paper; this paper is ${p.targetFormat}. Imported ${imported} compatible mark${plural(imported)}, skipped ${p.skipped}.`;
  }

  let base: string;
  if (p.hashMatch === "exact") {
    base = `Imported ${p.matched} mark${plural(p.matched)}.`;
  } else {
    const imported = p.matched + p.reanchored + p.flagged;
    base = `Imported ${imported} mark${plural(imported)} — re-anchored ${p.reanchored}, flagged ${p.flagged} for review (the document differs from the original).`;
  }
  // Same-format imports skip only when an archive is internally inconsistent
  // (a mark whose anchor kind doesn't fit its document). Rare, but report it
  // rather than let the count silently disagree.
  if (p.skipped > 0) {
    base += ` · skipped ${p.skipped} incompatible mark${plural(p.skipped)}.`;
  }
  if (p.unknownCount > 0) {
    base += ` · ${p.unknownCount} mark${plural(p.unknownCount)} use categories not in this project.`;
  }
  return base;
}

export async function importMarksArchive(
  input: ImportMarksArchiveInput,
): Promise<ImportMarksArchiveResult> {
  const { archive, targetRevisionId, targetFormat, targetCategorySlugs, reanchor, newId } = input;

  const formatMismatch = archive.document.format !== targetFormat;
  const exact = !formatMismatch && archive.document.pdfSha256 === input.targetPdfSha256;
  const hashMatch: ImportHashMatch = formatMismatch
    ? "format-mismatch"
    : exact
      ? "exact"
      : "mismatch";

  // One stable remap per source group so cross-page marks stay linked.
  const groupIdMap = new Map<string, string>();
  const mapGroupId = (old: string): string => {
    const existing = groupIdMap.get(old);
    if (existing !== undefined) return existing;
    const fresh = newId();
    groupIdMap.set(old, fresh);
    return fresh;
  };

  const rows: AnnotationRow[] = [];
  const unknownCategories = new Set<string>();
  const flaggedIds: string[] = [];
  const droppedIds: string[] = [];
  let matched = 0;
  let reanchored = 0;
  let flagged = 0;
  let skipped = 0;

  for (const mark of archive.marks) {
    // Runs even when the document formats agree: a hand-built archive can pair
    // a `pdf` document with a `source` mark, and a wrong-kind anchor must never
    // reach a revision of the other format.
    if (!anchorAppliesToFormat(mark.anchor, targetFormat)) {
      droppedIds.push(mark.id);
      skipped += 1;
      continue;
    }

    if (!targetCategorySlugs.has(mark.category)) unknownCategories.add(mark.category);

    const id = newId();
    let anchor: AnchorFields = mark.anchor;
    let staleness: AnnotationStaleness = "ok";

    if (exact) {
      matched += 1;
    } else {
      const next = reanchor ? await reanchor(mark) : null;
      if (next) {
        anchor = next;
        reanchored += 1;
      } else {
        staleness = "quote-mismatch";
        flaggedIds.push(id);
        flagged += 1;
      }
    }

    rows.push({
      id,
      revisionId: targetRevisionId,
      category: mark.category,
      quote: mark.quote,
      contextBefore: mark.contextBefore,
      contextAfter: mark.contextAfter,
      anchor,
      note: mark.note,
      thread: mark.thread.map((entry) => ({ ...entry })),
      createdAt: mark.createdAt,
      staleness,
      ...(mark.groupId !== undefined ? { groupId: mapGroupId(mark.groupId) } : {}),
    });
  }

  const report: ImportReport = {
    hashMatch,
    matched,
    reanchored,
    flagged,
    skipped,
    unknownCategories: [...unknownCategories],
    flaggedIds,
    droppedIds,
    message: buildMessage({
      hashMatch,
      total: archive.marks.length,
      matched,
      reanchored,
      flagged,
      skipped,
      unknownCount: unknownCategories.size,
      sourceFormat: archive.document.format,
      targetFormat,
    }),
  };

  return { rows, report };
}
