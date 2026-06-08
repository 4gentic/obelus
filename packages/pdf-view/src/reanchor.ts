import { computeBbox, extract } from "@obelus/anchor";
import type { PdfAnchorFields } from "@obelus/repo";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { type DetailedMatch, getPageIndex, searchPdfDocumentDetailed } from "./find";

// What a mark needs to be re-located against a (possibly drifted) target PDF.
// `quote` is the normalized selection used verbatim as the search needle;
// `pageHint` is the mark's original 1-based page, used only to break ties.
export interface ReanchorInput {
  quote: string;
  contextBefore: string;
  contextAfter: string;
  pageHint?: number;
}

export type ReanchorConfidence = "exact-context" | "page-hint" | "unique" | "fallback-position";

export type ReanchorResult =
  | { ok: true; anchor: PdfAnchorFields; page: number; confidence: ReanchorConfidence }
  | { ok: false; reason: "quote-not-found" | "empty-quote" };

export interface ReanchorOptions {
  caseSensitive?: boolean;
  signal?: AbortSignal;
}

function commonPrefixLen(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i += 1;
  return i;
}

function commonSuffixLen(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[a.length - 1 - i] === b[b.length - 1 - i]) i += 1;
  return i;
}

type Scored = { match: DetailedMatch; score: number };

// Higher context-similarity wins; ties resolve by page hint, then lowest page,
// then earliest position — fully deterministic and reproducible across runs.
function beats(a: Scored, b: Scored, hintPage0: number): boolean {
  if (a.score !== b.score) return a.score > b.score;
  const aHint = a.match.pageIndex === hintPage0;
  const bHint = b.match.pageIndex === hintPage0;
  if (aHint !== bHint) return aHint;
  if (a.match.pageIndex !== b.match.pageIndex) return a.match.pageIndex < b.match.pageIndex;
  if (a.match.startItem !== b.match.startItem) return a.match.startItem < b.match.startItem;
  return a.match.startOffset < b.match.startOffset;
}

// Derives a candidate's surrounding text the same way the original mark's
// context was produced, so the similarity comparison is apples-to-apples.
async function candidateContext(
  doc: PDFDocumentProxy,
  match: DetailedMatch,
): Promise<{ contextBefore: string; contextAfter: string }> {
  const entry = await getPageIndex(doc, match.pageIndex);
  const page = await doc.getPage(match.pageIndex + 1);
  try {
    const viewport = page.getViewport({ scale: 1 });
    const ex = extract(
      {
        pageIndex: match.pageIndex,
        startItem: match.startItem,
        startOffset: match.startOffset,
        endItem: match.endItem,
        endOffset: match.endOffset,
      },
      entry.items,
      viewport,
    );
    return { contextBefore: ex.contextBefore, contextAfter: ex.contextAfter };
  } finally {
    page.cleanup();
  }
}

// Re-locates a mark's quote in the current target document and rebuilds a PDF
// anchor whose text-item range matches the live text layer. Returns a failure
// (not a guess) when the quote can't be found — the caller keeps the mark and
// flags it rather than misplacing the highlight.
export async function reanchorPdfMark(
  doc: PDFDocumentProxy,
  input: ReanchorInput,
  opts: ReanchorOptions = {},
): Promise<ReanchorResult> {
  if (input.quote.length === 0) return { ok: false, reason: "empty-quote" };

  const matches = await searchPdfDocumentDetailed(doc, input.quote, opts);
  if (matches.length === 0) return { ok: false, reason: "quote-not-found" };

  const hintPage0 = input.pageHint !== undefined ? input.pageHint - 1 : -1;

  const scored: Scored[] = [];
  for (const match of matches) {
    const ctx = await candidateContext(doc, match);
    const score =
      commonSuffixLen(ctx.contextBefore, input.contextBefore) +
      commonPrefixLen(ctx.contextAfter, input.contextAfter);
    scored.push({ match, score });
  }
  const best = scored.reduce((acc, cand) => (beats(cand, acc, hintPage0) ? cand : acc));

  let confidence: ReanchorConfidence;
  if (matches.length === 1) {
    confidence = "unique";
  } else if (scored.every((s) => s === best || best.score > s.score) && best.score > 0) {
    confidence = "exact-context";
  } else if (hintPage0 >= 0 && best.match.pageIndex === hintPage0) {
    confidence = "page-hint";
  } else {
    confidence = "fallback-position";
  }

  const winner = best.match;
  const entry = await getPageIndex(doc, winner.pageIndex);
  const page = await doc.getPage(winner.pageIndex + 1);
  try {
    const viewport = page.getViewport({ scale: 1 });
    const bbox = computeBbox(entry.items, viewport, winner.startItem, winner.endItem);
    const anchor: PdfAnchorFields = {
      kind: "pdf",
      page: winner.pageIndex + 1,
      bbox: [bbox[0], bbox[1], bbox[2], bbox[3]],
      textItemRange: {
        start: [winner.startItem, winner.startOffset],
        end: [winner.endItem, winner.endOffset],
      },
    };
    return { ok: true, anchor, page: winner.pageIndex + 1, confidence };
  } finally {
    page.cleanup();
  }
}
