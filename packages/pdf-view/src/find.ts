import { type Bbox, normalizeForSearch, normalizeQuery, rectsFromAnchor } from "@obelus/anchor";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TextItem, TextMarkedContent } from "pdfjs-dist/types/src/display/api";

export type FindMatch = {
  pageIndex: number;
  matchIndex: number;
  rects: ReadonlyArray<Bbox>;
};

// A search hit with its full text-item range recovered — the shape re-anchoring
// needs. `searchPdfDocument` projects this down to `FindMatch`; both share one
// search/index path so find and re-anchor can never drift. `endOffset` is
// exclusive (the convention `Anchor` and `rectsFromAnchor` expect).
export type DetailedMatch = {
  pageIndex: number;
  startItem: number;
  startOffset: number;
  endItem: number;
  endOffset: number;
  rects: ReadonlyArray<Bbox>;
};

export type FindOptions = {
  caseSensitive?: boolean;
  signal?: AbortSignal;
};

// Per-page cache keyed weakly on the PDFDocumentProxy, so cache entries vanish
// with the document and we don't hold pdfjs internals alive after the pane
// unmounts. Compiled Typst rebinds the proxy per compile, which invalidates
// this cache implicitly — exactly what we want.
export type PageIndex = {
  items: ReadonlyArray<TextItem>;
  text: string;
  itemForChar: Int32Array;
  offsetForChar: Int32Array;
  // Typographic-tolerant haystack: NFKC-folded `text` (ligatures, smart
  // quotes/dashes, exotic spaces) plus the offset map that projects a hit in
  // `norm` back onto the original `text` indices the mapping arrays key on.
  norm: string;
  normMap: Int32Array;
};
type DocIndex = Map<number, PageIndex>;
const cache = new WeakMap<PDFDocumentProxy, DocIndex>();

function isTextItem(raw: TextItem | TextMarkedContent): raw is TextItem {
  return "str" in raw;
}

function needsSyntheticBreak(item: TextItem, next: TextItem): boolean {
  return (
    item.hasEOL === true || (item.str.length > 0 && !/\s$/.test(item.str) && !/^\s/.test(next.str))
  );
}

// A synthetic space (marked with -1 in the mapping arrays) is inserted between
// items that visually break a word, so the user's query "hello world" still
// matches when pdfjs emits "hello" and "world" as two items on separate lines.
// Matches that include a synthetic char at either boundary are discarded in
// the search pass.
export function indexPage(rawItems: ReadonlyArray<TextItem | TextMarkedContent>): PageIndex {
  const items: TextItem[] = [];
  for (const raw of rawItems) {
    if (isTextItem(raw) && raw.str !== "") items.push(raw);
  }

  // The synthetic predicate runs twice: once to size the typed arrays to the
  // joined-string length exactly, once to fill them. Any divergence between
  // the two passes would misalign itemForChar/offsetForChar against the joined
  // string — keep them in lockstep.
  let totalLen = 0;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item) continue;
    totalLen += item.str.length;
    const next = items[i + 1];
    if (next !== undefined && needsSyntheticBreak(item, next)) totalLen += 1;
  }

  const text = new Array<string>(totalLen);
  const itemForChar = new Int32Array(totalLen);
  const offsetForChar = new Int32Array(totalLen);

  let cursor = 0;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item) continue;
    for (let k = 0; k < item.str.length; k += 1) {
      text[cursor] = item.str[k] ?? "";
      itemForChar[cursor] = i;
      offsetForChar[cursor] = k;
      cursor += 1;
    }
    const next = items[i + 1];
    if (next !== undefined && needsSyntheticBreak(item, next)) {
      text[cursor] = " ";
      itemForChar[cursor] = -1;
      offsetForChar[cursor] = -1;
      cursor += 1;
    }
  }
  const joined = text.join("");
  const { text: norm, map: normMap } = normalizeForSearch(joined);
  return { items, text: joined, itemForChar, offsetForChar, norm, normMap };
}

export async function getPageIndex(doc: PDFDocumentProxy, pageIndex: number): Promise<PageIndex> {
  let docEntry = cache.get(doc);
  if (!docEntry) {
    docEntry = new Map();
    cache.set(doc, docEntry);
  }
  const existing = docEntry.get(pageIndex);
  if (existing) return existing;
  const page = await doc.getPage(pageIndex + 1);
  try {
    const content = await page.getTextContent();
    const entry = indexPage(content.items as Array<TextItem | TextMarkedContent>);
    docEntry.set(pageIndex, entry);
    return entry;
  } finally {
    page.cleanup();
  }
}

function caseFold(s: string, caseSensitive: boolean): string {
  return caseSensitive ? s : s.toLocaleLowerCase();
}

export async function searchPdfDocumentDetailed(
  doc: PDFDocumentProxy,
  rawQuery: string,
  opts: FindOptions = {},
): Promise<DetailedMatch[]> {
  const query = rawQuery;
  if (query.length === 0) return [];
  const caseSensitive = opts.caseSensitive === true;
  const needle = caseFold(normalizeQuery(query), caseSensitive);
  if (needle.length === 0) return [];
  const matches: DetailedMatch[] = [];
  const pageCount = doc.numPages;
  const pagesWithMatches: number[] = [];

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    if (opts.signal?.aborted) throw opts.signal.reason ?? new Error("search aborted");
    const entry = await getPageIndex(doc, pageIndex);
    if (entry.text.length === 0) continue;
    const hay = caseFold(entry.norm, caseSensitive);

    const page = await doc.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale: 1 });
    try {
      let matchesOnPage = 0;
      let from = 0;
      while (from <= hay.length - needle.length) {
        const hit = hay.indexOf(needle, from);
        if (hit < 0) break;
        // `hit` indexes normalized text; project the match back onto the
        // original `text` indices the mapping arrays key on. The first matched
        // unit comes from source char `startSrc`, the last from `endSrc`. They
        // coincide when the whole match lies inside one expanded char (e.g. the
        // "fi" ligature), so the span covers that single source glyph.
        const startSrc = entry.normMap[hit] ?? -1;
        const endSrc = entry.normMap[hit + needle.length - 1] ?? -1;
        const startItem = entry.itemForChar[startSrc] ?? -1;
        const startOffset = entry.offsetForChar[startSrc] ?? -1;
        const endItem = entry.itemForChar[endSrc] ?? -1;
        const endCharOffset = entry.offsetForChar[endSrc] ?? -1;
        if (
          startSrc < 0 ||
          endSrc < 0 ||
          startItem < 0 ||
          endItem < 0 ||
          startOffset < 0 ||
          endCharOffset < 0
        ) {
          from = hit + 1;
          continue;
        }
        const endOffset = endCharOffset + 1;
        const rects = rectsFromAnchor(
          { pageIndex, startItem, startOffset, endItem, endOffset },
          entry.items,
          viewport,
        );
        if (rects.length > 0) {
          matches.push({ pageIndex, startItem, startOffset, endItem, endOffset, rects });
          matchesOnPage += 1;
        }
        from = hit + 1;
      }
      if (matchesOnPage > 0) pagesWithMatches.push(pageIndex);
    } finally {
      page.cleanup();
    }
  }

  console.info("[find-pdf]", {
    query,
    caseSensitive,
    pageCount,
    matchCount: matches.length,
    pagesWithMatches,
  });

  return matches;
}

// Thin projection of the detailed search for the FindBar, which needs only
// rects and a sequential match index.
export async function searchPdfDocument(
  doc: PDFDocumentProxy,
  rawQuery: string,
  opts: FindOptions = {},
): Promise<FindMatch[]> {
  const detailed = await searchPdfDocumentDetailed(doc, rawQuery, opts);
  return detailed.map((match, matchIndex) => ({
    pageIndex: match.pageIndex,
    matchIndex,
    rects: match.rects,
  }));
}
