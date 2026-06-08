import {
  type Anchor,
  MARKS_ARCHIVE_VERSION,
  type MarksArchive,
  type MarksArchiveMark,
  type ProjectCategory,
} from "@obelus/bundle-schema";
import type { AnchorFields, AnnotationRow, PaperFormat } from "@obelus/repo";

export interface BuildMarksArchiveInput {
  rows: ReadonlyArray<AnnotationRow>;
  document: {
    format: PaperFormat;
    title: string;
    pdfSha256: string;
    pageCount?: number;
  };
  // The source project's categories travel with the archive so labels/colors
  // survive and the importer can report which slugs the target lacks.
  categories: ReadonlyArray<ProjectCategory>;
  toolVersion: string;
  // Injectable for deterministic tests; defaults to the wall clock.
  now?: () => Date;
}

// `rects` is a render-time cache on the PDF row that the wire `Anchor` omits —
// drop it so the exported anchor matches the schema exactly.
function stripRects(anchor: AnchorFields): Anchor {
  if (anchor.kind === "pdf") {
    return {
      kind: "pdf",
      page: anchor.page,
      bbox: anchor.bbox,
      textItemRange: anchor.textItemRange,
    };
  }
  return anchor;
}

function toMark(row: AnnotationRow): MarksArchiveMark {
  return {
    id: row.id,
    category: row.category,
    quote: row.quote,
    contextBefore: row.contextBefore,
    contextAfter: row.contextAfter,
    anchor: stripRects(row.anchor),
    note: row.note,
    thread: row.thread.map((entry) => ({ ...entry })),
    createdAt: row.createdAt,
    ...(row.groupId !== undefined ? { groupId: row.groupId } : {}),
  };
}

export function buildMarksArchive(input: BuildMarksArchiveInput): MarksArchive {
  const exportedAt = (input.now?.() ?? new Date()).toISOString();
  return {
    marksArchiveVersion: MARKS_ARCHIVE_VERSION,
    tool: { name: "obelus", version: input.toolVersion },
    exportedAt,
    document: {
      format: input.document.format,
      title: input.document.title,
      pdfSha256: input.document.pdfSha256,
      ...(input.document.pageCount !== undefined ? { pageCount: input.document.pageCount } : {}),
    },
    categories: input.categories.map((category) => ({ ...category })),
    marks: input.rows.map(toMark),
  };
}
