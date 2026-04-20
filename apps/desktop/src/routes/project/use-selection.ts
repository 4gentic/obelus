import { type Anchor, extract, rectsFromAnchor } from "@obelus/anchor";
import type { DraftInput, DraftSlice } from "@obelus/review-store";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { useCallback } from "react";
import { useReviewStore } from "./store-context";

export function useSelectionHandler(
  doc: PDFDocumentProxy | null,
): (
  anchors: Anchor[],
  quote: string,
  itemsByPage: ReadonlyMap<number, ReadonlyArray<TextItem>>,
) => void {
  const store = useReviewStore();

  return useCallback(
    (anchors, _quote, itemsByPage) => {
      if (!doc || anchors.length === 0) return;
      void (async () => {
        const built = await Promise.all(
          anchors.map(async (anchor) => {
            const items = itemsByPage.get(anchor.pageIndex);
            if (!items) return null;
            const page = await doc.getPage(anchor.pageIndex + 1);
            const viewport = page.getViewport({ scale: 1 });
            const ext = extract(anchor, items, viewport);
            const rects = rectsFromAnchor(anchor, items, viewport);
            return {
              anchor,
              quote: ext.quote,
              contextBefore: ext.contextBefore,
              contextAfter: ext.contextAfter,
              bbox: ext.bbox,
              rects,
            } satisfies DraftSlice;
          }),
        );
        const slices: DraftSlice[] = built.filter((s): s is DraftSlice => s !== null);
        const first = slices[0];
        const last = slices[slices.length - 1];
        if (!first || !last) return;
        const draft: DraftInput = {
          slices,
          quote: slices.map((s) => s.quote).join(" \u2026 "),
          contextBefore: first.contextBefore,
          contextAfter: last.contextAfter,
        };
        store.getState().setSelectedAnchor(draft);
      })();
    },
    [doc, store],
  );
}
