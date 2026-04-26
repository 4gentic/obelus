import { type FindMatch, searchPdfDocument } from "@obelus/pdf-view";
import type { FindProvider, FindSearchOptions } from "@obelus/review-shell";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { create, type StoreApi, type UseBoundStore } from "zustand";

// Per-provider Zustand atom that holds the rect data PdfPane needs to paint
// find highlights. Lives outside the cross-format `find-store` so the shared
// store doesn't grow a PDF-shaped union; PdfPane subscribes here, the rest
// of the app subscribes to the shared store.
export interface PdfFindRectsState {
  matches: ReadonlyArray<FindMatch>;
  currentIndex: number;
}

export type PdfFindRectsStore = UseBoundStore<StoreApi<PdfFindRectsState>>;

export function createPdfFindRectsStore(): PdfFindRectsStore {
  return create<PdfFindRectsState>()(() => ({ matches: [], currentIndex: -1 }));
}

export function createPdfFindProvider(
  doc: PDFDocumentProxy,
  rectsStore: PdfFindRectsStore,
): FindProvider {
  let cachedMatches: ReadonlyArray<FindMatch> = [];

  return {
    async search(query: string, opts: FindSearchOptions): Promise<number> {
      const matches = await searchPdfDocument(doc, query, {
        caseSensitive: opts.caseSensitive,
        ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
      });
      cachedMatches = matches;
      const currentIndex = matches.length > 0 ? 0 : -1;
      rectsStore.setState({ matches, currentIndex });
      return matches.length;
    },
    goto(index: number): void {
      if (index < 0 || index >= cachedMatches.length) return;
      rectsStore.setState({ currentIndex: index });
    },
    clear(): void {
      cachedMatches = [];
      rectsStore.setState({ matches: [], currentIndex: -1 });
    },
  };
}
