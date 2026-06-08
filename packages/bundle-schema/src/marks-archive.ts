import { z } from "zod";
import { Anchor, ProjectCategory, ThreadEntry } from "./schema.js";

export const MARKS_ARCHIVE_VERSION = "1.0" as const;

// A portable copy of one mark — the `Annotation` shape minus `paperId` (an
// archive is single-paper) and minus the PDF anchor's `rects` UI cache (already
// absent from the wire `Anchor`). `id`/`groupId` travel so grouped marks can be
// re-linked; the importer regenerates both to avoid collisions on the target.
export const MarksArchiveMark = z.object({
  id: z.string().uuid(),
  category: z.string().min(1),
  quote: z.string().min(1),
  contextBefore: z.string(),
  contextAfter: z.string(),
  anchor: Anchor,
  note: z.string().default(""),
  thread: z.array(ThreadEntry).default([]),
  createdAt: z.string().datetime({ offset: false }),
  groupId: z.string().uuid().optional(),
});

// Identity of the source document. `pdfSha256` is the exact-match key: equal
// bytes mean every stored anchor is still correct and import skips re-anchoring.
// (The column is named for PDFs but holds the content hash for every format.)
export const MarksArchiveDocument = z.object({
  format: z.enum(["pdf", "md", "html"]),
  title: z.string(),
  pdfSha256: z.string().regex(/^[a-f0-9]{64}$/),
  pageCount: z.number().int().positive().optional(),
});

// Cross-project import is the point of this format, so — unlike `Bundle` —
// category membership is NOT a parse-time error; reconciliation is deferred to
// the importer, which keeps unknown slugs and reports them.
export const MarksArchive = z.object({
  marksArchiveVersion: z.literal(MARKS_ARCHIVE_VERSION),
  tool: z.object({ name: z.literal("obelus"), version: z.string() }),
  exportedAt: z.string().datetime({ offset: false }),
  document: MarksArchiveDocument,
  categories: z.array(ProjectCategory),
  marks: z.array(MarksArchiveMark),
});

export type MarksArchive = z.infer<typeof MarksArchive>;
export type MarksArchiveMark = z.infer<typeof MarksArchiveMark>;
export type MarksArchiveDocument = z.infer<typeof MarksArchiveDocument>;
