import type { AnchorFields, AnnotationRow, DiffHunkRow } from "@obelus/repo";

// Re-anchors the diff list from "hunk N/M grouped by file" to "the suggestion
// for the passage you marked, in document order". A hunk's place in the
// stream is decided by where the user's mark sits in the manuscript — file,
// then line (source/html) or page-then-height (pdf). Synthesised blocks
// (cascade-/impact-/…) and rows whose mark can't be resolved have no anchor;
// they fall back to the planner's `ordinal`. The sort is stable: ties resolve
// by `ordinal` so the order never reshuffles between renders.

// A position inside one file (or, for pdf, one page). `primary` is the line or
// page; `secondary` is the column or vertical offset that breaks ties on the
// same line/page.
interface InFilePosition {
  primary: number;
  secondary: number;
}

// All pdf anchors share one bucket — there are no file paths in a pdf, so a
// rank that sorts after every source/html file keeps them contiguous and last
// without colliding with a real file name. A session is single-format in
// practice, so the buckets rarely mix; the rank only has to be deterministic.
const PDF_FILE_BUCKET = "￿::pdf";

function anchorFile(anchor: AnchorFields): string | null {
  switch (anchor.kind) {
    case "source":
      return anchor.file;
    case "html":
    case "html-element":
      return anchor.sourceHint?.file ?? anchor.file;
    case "pdf":
      return PDF_FILE_BUCKET;
  }
}

function inFilePosition(anchor: AnchorFields): InFilePosition {
  switch (anchor.kind) {
    case "source":
      return { primary: anchor.lineStart, secondary: anchor.colStart };
    case "html":
      return anchor.sourceHint
        ? { primary: anchor.sourceHint.lineStart, secondary: anchor.sourceHint.colStart }
        : { primary: anchor.charOffsetStart, secondary: 0 };
    case "html-element":
      return anchor.sourceHint
        ? { primary: anchor.sourceHint.lineStart, secondary: anchor.sourceHint.colStart }
        : { primary: 0, secondary: 0 };
    case "pdf":
      // bbox is [x0, y0, x1, y1]; the renderer reads y0 (bbox[1]) as the
      // mark's height from the page top (see pdf-view adapter), so smaller y0
      // is higher on the page and earlier in reading order.
      return { primary: anchor.page, secondary: anchor.bbox[1] };
  }
}

// Lower sorts earlier. Source/html files rank by `fileOrder` (the paper's own
// file sequence) when present, else alphabetically — both keep a file's
// suggestions contiguous. Unranked files sort after ranked ones.
function fileRank(file: string, fileOrder: ReadonlyMap<string, number>): number {
  const ranked = fileOrder.get(file);
  return ranked ?? Number.MAX_SAFE_INTEGER;
}

export interface AnchorKey {
  fileRank: number;
  file: string;
  primary: number;
  secondary: number;
}

function anchorKey(anchor: AnchorFields, fileOrder: ReadonlyMap<string, number>): AnchorKey {
  const file = anchorFile(anchor) ?? PDF_FILE_BUCKET;
  const { primary, secondary } = inFilePosition(anchor);
  return { fileRank: fileRank(file, fileOrder), file, primary, secondary };
}

// The mark whose suggestion this hunk leads with: the resolvable linked
// annotation sitting earliest in the document. A hunk may satisfy several
// marks; the earliest one decides where the card appears. Returns null when no
// linked id resolves (synthesised block, or marks archived out of the cache).
export function primaryAnnotation(
  hunk: DiffHunkRow,
  annotationsById: ReadonlyMap<string, AnnotationRow>,
  fileOrder: ReadonlyMap<string, number>,
): AnnotationRow | null {
  let best: AnnotationRow | null = null;
  let bestKey: AnchorKey | null = null;
  for (const id of hunk.annotationIds) {
    const row = annotationsById.get(id);
    if (!row) continue;
    const key = anchorKey(row.anchor, fileOrder);
    if (bestKey === null || compareAnchorKey(key, bestKey) < 0) {
      best = row;
      bestKey = key;
    }
  }
  return best;
}

function compareAnchorKey(a: AnchorKey, b: AnchorKey): number {
  if (a.fileRank !== b.fileRank) return a.fileRank - b.fileRank;
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  if (a.primary !== b.primary) return a.primary - b.primary;
  return a.secondary - b.secondary;
}

// The hunk's sort key. Anchored hunks carry an `anchor`; anchorless ones carry
// null and are placed by `ordinal` alone. `ordinal` rides along on every key as
// the stable tiebreak.
export interface DocumentOrderKey {
  anchor: AnchorKey | null;
  ordinal: number;
}

export function documentOrderKey(
  hunk: DiffHunkRow,
  annotationsById: ReadonlyMap<string, AnnotationRow>,
  fileOrder: ReadonlyMap<string, number>,
): DocumentOrderKey {
  const primary = primaryAnnotation(hunk, annotationsById, fileOrder);
  return {
    anchor: primary ? anchorKey(primary.anchor, fileOrder) : null,
    ordinal: hunk.ordinal,
  };
}

// Anchored hunks precede anchorless ones; within each group, anchor position
// then `ordinal`. Anchorless hunks order by `ordinal`. The trailing `ordinal`
// comparison makes the whole order total and stable.
export function compareDocumentOrder(a: DocumentOrderKey, b: DocumentOrderKey): number {
  if (a.anchor !== null && b.anchor !== null) {
    const byAnchor = compareAnchorKey(a.anchor, b.anchor);
    if (byAnchor !== 0) return byAnchor;
    return a.ordinal - b.ordinal;
  }
  if (a.anchor !== null) return -1;
  if (b.anchor !== null) return 1;
  return a.ordinal - b.ordinal;
}

// Returns a new array; never mutates the input (the diff store's `hunks` array
// is the index space for `focusedIndex`, so it must stay in ordinal order).
export function sortByDocumentOrder(
  hunks: ReadonlyArray<DiffHunkRow>,
  annotationsById: ReadonlyMap<string, AnnotationRow>,
  fileOrder: ReadonlyMap<string, number>,
): DiffHunkRow[] {
  return [...hunks].sort((a, b) =>
    compareDocumentOrder(
      documentOrderKey(a, annotationsById, fileOrder),
      documentOrderKey(b, annotationsById, fileOrder),
    ),
  );
}

// The file order a hunk's resolved anchor implies, in document order. Drives
// the file filter so its rows match the stream's file sequence rather than the
// map-insertion order of `groupByFile`. Files with no resolvable anchor (only
// synthesised/anchorless hunks) fall to the end, ordered by their first hunk's
// `ordinal`.
export function filesInDocumentOrder(
  hunks: ReadonlyArray<DiffHunkRow>,
  fileKeyOf: (h: DiffHunkRow) => string,
  annotationsById: ReadonlyMap<string, AnnotationRow>,
  fileOrder: ReadonlyMap<string, number>,
): string[] {
  const firstKeyByFile = new Map<string, DocumentOrderKey>();
  for (const h of sortByDocumentOrder(hunks, annotationsById, fileOrder)) {
    const file = fileKeyOf(h);
    if (!firstKeyByFile.has(file)) {
      firstKeyByFile.set(file, documentOrderKey(h, annotationsById, fileOrder));
    }
  }
  return [...firstKeyByFile.keys()].sort((a, b) => {
    const ka = firstKeyByFile.get(a);
    const kb = firstKeyByFile.get(b);
    if (!ka || !kb) return 0;
    return compareDocumentOrder(ka, kb);
  });
}
