// Registry that pairs a rendered page's DOM wrapper with the exact TextItem
// array pdfjs's TextLayer consumed to create its spans. Keyed by the
// `[data-page-index]` element via a WeakMap so entries vanish when the page
// unmounts. SelectionListener reads from here instead of calling
// `page.getTextContent()` independently — that independent call is what
// silently drifted out of order from the actual text-layer spans on pages
// where pdfjs normalizes or reorders the stream differently per call.

import type { TextItem } from "pdfjs-dist/types/src/display/api";

const registry = new WeakMap<HTMLElement, ReadonlyArray<TextItem>>();

export function setPageItems(pageEl: HTMLElement, items: ReadonlyArray<TextItem>): void {
  registry.set(pageEl, items);
}

export function getPageItems(pageEl: HTMLElement): ReadonlyArray<TextItem> | null {
  return registry.get(pageEl) ?? null;
}

export function clearPageItems(pageEl: HTMLElement): void {
  registry.delete(pageEl);
}
