// Walk up from `el` to the first scrollable ancestor, falling back to the
// document's scrolling element. Mirrors the same helper duplicated inside
// `packages/pdf-view` and `packages/md-view` adapters — kept local here so
// the desktop's MarginGutter / scroll-publishers don't reach into package
// internals.
export function findScrollAncestor(el: HTMLElement): HTMLElement {
  let cur: HTMLElement | null = el.parentElement;
  while (cur) {
    const overflow = getComputedStyle(cur).overflowY;
    if (/(auto|scroll|overlay)/.test(overflow)) return cur;
    cur = cur.parentElement;
  }
  return (
    (el.ownerDocument?.scrollingElement as HTMLElement | null) ??
    el.ownerDocument?.documentElement ??
    el
  );
}
