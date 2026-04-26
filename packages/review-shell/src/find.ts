// Cross-format find contract. Each format adapter (PDF, MD, HTML) exposes a
// FindProvider so the shared FindBar / find-store can drive the search without
// knowing whether matches live on a pdfjs page, in a markdown DOM, or inside a
// sandboxed iframe. Providers own their own indexing, painting, and scroll.
//
// Lifecycle:
//   • search() runs once per query/case-sensitivity change. Returning the
//     count is enough for the UI counter; rect data stays internal to the
//     provider so the store doesn't grow per-format unions.
//   • goto(i) is called when the user steps next/prev or when search()
//     resolves with at least one match (the store seeds index 0).
//   • clear() is called when the bar closes or when a new provider replaces
//     this one — the implementation must drop highlights and any cached
//     traversal state.
export interface FindProvider {
  search(query: string, opts: FindSearchOptions): Promise<number>;
  goto(index: number): void;
  clear(): void;
}

export interface FindSearchOptions {
  readonly caseSensitive: boolean;
  readonly signal?: AbortSignal;
}
