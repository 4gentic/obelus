import type { FindMatch } from "@obelus/pdf-view";
import { searchPdfDocument } from "@obelus/pdf-view";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { create, type StoreApi, type UseBoundStore } from "zustand";

export type FindStatus = "idle" | "searching" | "ready" | "error";

export interface FindState {
  isOpen: boolean;
  query: string;
  status: FindStatus;
  matches: ReadonlyArray<FindMatch>;
  currentIndex: number;
  caseSensitive: boolean;
  // Bumped each time the current match changes so PdfPane can scroll without
  // observing the matches array identity (which also changes on every search).
  scrollTick: number;
  error: string | null;

  open(): void;
  close(): void;
  toggle(): void;
  setQuery(next: string): void;
  setCaseSensitive(next: boolean): void;
  setDoc(doc: PDFDocumentProxy | null): void;
  next(): void;
  prev(): void;
}

export type FindStore = UseBoundStore<StoreApi<FindState>>;

const DEBOUNCE_MS = 120;

export function createFindStore(): FindStore {
  let doc: PDFDocumentProxy | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  let searchToken = 0;

  return create<FindState>()((set, get) => {
    function cancelPending(): void {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (controller) {
        controller.abort();
        controller = null;
      }
    }

    function runSearch(query: string, caseSensitive: boolean): void {
      if (!doc) {
        set({ matches: [], currentIndex: -1, status: "idle", error: null });
        return;
      }
      if (query.length === 0) {
        set({ matches: [], currentIndex: -1, status: "idle", error: null });
        return;
      }
      controller = new AbortController();
      const ac = controller;
      const token = ++searchToken;
      set({ status: "searching", error: null });
      searchPdfDocument(doc, query, { caseSensitive, signal: ac.signal }).then(
        (matches) => {
          if (token !== searchToken) return;
          const currentIndex = matches.length > 0 ? 0 : -1;
          set((prev) => ({
            matches,
            currentIndex,
            status: "ready",
            error: null,
            scrollTick: currentIndex >= 0 ? prev.scrollTick + 1 : prev.scrollTick,
          }));
        },
        (err: unknown) => {
          if (token !== searchToken) return;
          if (ac.signal.aborted) return;
          const message = err instanceof Error ? err.message : "search failed";
          console.error("[find-pdf]", message, err);
          set({ status: "error", matches: [], currentIndex: -1, error: message });
        },
      );
    }

    return {
      isOpen: false,
      query: "",
      status: "idle",
      matches: [],
      currentIndex: -1,
      caseSensitive: false,
      scrollTick: 0,
      error: null,

      open(): void {
        set({ isOpen: true });
        const { query, caseSensitive } = get();
        if (query.length > 0) runSearch(query, caseSensitive);
      },
      close(): void {
        cancelPending();
        set({ isOpen: false, status: "idle", error: null });
      },
      toggle(): void {
        if (get().isOpen) get().close();
        else get().open();
      },
      setQuery(next: string): void {
        set({ query: next });
        cancelPending();
        const caseSensitive = get().caseSensitive;
        if (next.length === 0) {
          set({ matches: [], currentIndex: -1, status: "idle", error: null });
          return;
        }
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          runSearch(next, caseSensitive);
        }, DEBOUNCE_MS);
      },
      setCaseSensitive(next: boolean): void {
        set({ caseSensitive: next });
        const query = get().query;
        if (query.length > 0) runSearch(query, next);
      },
      setDoc(nextDoc: PDFDocumentProxy | null): void {
        if (doc === nextDoc) return;
        cancelPending();
        doc = nextDoc;
        set({ matches: [], currentIndex: -1, status: "idle", error: null });
        const { isOpen, query, caseSensitive } = get();
        if (isOpen && nextDoc && query.length > 0) runSearch(query, caseSensitive);
      },
      next(): void {
        const { matches, currentIndex } = get();
        if (matches.length === 0) return;
        const nextIndex = (currentIndex + 1) % matches.length;
        set((prev) => ({ currentIndex: nextIndex, scrollTick: prev.scrollTick + 1 }));
      },
      prev(): void {
        const { matches, currentIndex } = get();
        if (matches.length === 0) return;
        const nextIndex = (currentIndex - 1 + matches.length) % matches.length;
        set((prev) => ({ currentIndex: nextIndex, scrollTick: prev.scrollTick + 1 }));
      },
    };
  });
}
