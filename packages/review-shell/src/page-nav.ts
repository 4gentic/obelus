// Page-navigation contract for paginated surfaces. PDF is the only format with
// real pages today; Markdown and HTML omit this capability the same way they'd
// omit `find`. A continuous-scroll viewer can't expose `current` as a plain
// reactive value without re-rendering every chrome consumer on each scroll
// frame, so the provider is a STABLE object whose identity never changes for
// the document's lifetime — only the value `current()` returns moves, and
// `subscribe` is how chrome (the desktop toolbar, the web breadcrumb) opts into
// those changes via `useSyncExternalStore`.
export interface PageNavProvider {
  /** Total page count. Stable for the document's lifetime. */
  readonly count: number;
  /** 1-indexed page under the viewport's reference line. */
  current(): number;
  /** Subscribe to current-page changes; returns an unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Scroll so `page` (1-indexed, clamped to [1, count]) aligns near the top. */
  goTo(page: number): void;
}
