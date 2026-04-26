import type { FindProvider } from "@obelus/review-shell";
import { create, type StoreApi, type UseBoundStore } from "zustand";

export type FindStatus = "idle" | "searching" | "ready" | "error";

export interface FindState {
  isOpen: boolean;
  query: string;
  caseSensitive: boolean;
  status: FindStatus;
  count: number;
  currentIndex: number;
  // Bumped each time the active match changes so format-specific surfaces
  // (e.g. PdfPane) can scroll without observing rect arrays whose identity
  // also rolls on every search.
  scrollTick: number;
  // Bumped on every open() so FindBar refocuses even when isOpen is already true.
  focusTick: number;
  error: string | null;

  open(): void;
  close(): void;
  toggle(): void;
  setQuery(next: string): void;
  setCaseSensitive(next: boolean): void;
  setProvider(provider: FindProvider | null): void;
  // Wipes query/caseSensitive in addition to closing — called when the
  // open paper changes so cross-paper find state doesn't leak.
  resetForPaperSwap(): void;
  next(): void;
  prev(): void;
}

export type FindStore = UseBoundStore<StoreApi<FindState>>;

const DEBOUNCE_MS = 120;

export function createFindStore(): FindStore {
  let provider: FindProvider | null = null;
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
      const p = provider;
      if (!p) {
        set({ count: 0, currentIndex: -1, status: "idle", error: null });
        return;
      }
      if (query.length === 0) {
        p.clear();
        set({ count: 0, currentIndex: -1, status: "idle", error: null });
        return;
      }
      controller = new AbortController();
      const ac = controller;
      const token = ++searchToken;
      set({ status: "searching", error: null });
      p.search(query, { caseSensitive, signal: ac.signal }).then(
        (count) => {
          if (token !== searchToken) return;
          const currentIndex = count > 0 ? 0 : -1;
          if (currentIndex >= 0) p.goto(currentIndex);
          set((prev) => ({
            count,
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
          console.error("[find]", message, err);
          set({ status: "error", count: 0, currentIndex: -1, error: message });
        },
      );
    }

    return {
      isOpen: false,
      query: "",
      caseSensitive: false,
      status: "idle",
      count: 0,
      currentIndex: -1,
      scrollTick: 0,
      focusTick: 0,
      error: null,

      open(): void {
        set((prev) => ({ isOpen: true, focusTick: prev.focusTick + 1 }));
        const { query, caseSensitive } = get();
        if (query.length > 0) runSearch(query, caseSensitive);
      },
      // Closes the bar but keeps query + caseSensitive so the next open()
      // (or a viewMode toggle handing off to CodeMirror) re-uses them.
      close(): void {
        cancelPending();
        provider?.clear();
        set({
          isOpen: false,
          count: 0,
          currentIndex: -1,
          status: "idle",
          error: null,
        });
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
          provider?.clear();
          set({ count: 0, currentIndex: -1, status: "idle", error: null });
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
      setProvider(nextProvider: FindProvider | null): void {
        if (provider === nextProvider) return;
        cancelPending();
        provider?.clear();
        provider = nextProvider;
        set({ count: 0, currentIndex: -1, status: "idle", error: null });
        const { isOpen, query, caseSensitive } = get();
        if (isOpen && nextProvider && query.length > 0) runSearch(query, caseSensitive);
      },
      resetForPaperSwap(): void {
        cancelPending();
        provider?.clear();
        set({
          isOpen: false,
          query: "",
          caseSensitive: false,
          count: 0,
          currentIndex: -1,
          status: "idle",
          error: null,
        });
      },
      next(): void {
        const { count, currentIndex } = get();
        if (count === 0) return;
        const nextIndex = (currentIndex + 1) % count;
        provider?.goto(nextIndex);
        set((prev) => ({ currentIndex: nextIndex, scrollTick: prev.scrollTick + 1 }));
      },
      prev(): void {
        const { count, currentIndex } = get();
        if (count === 0) return;
        const nextIndex = (currentIndex - 1 + count) % count;
        provider?.goto(nextIndex);
        set((prev) => ({ currentIndex: nextIndex, scrollTick: prev.scrollTick + 1 }));
      },
    };
  });
}
