import { selectionToSourceAnchor } from "@obelus/anchor";
import type { SourceAnchor2 } from "@obelus/bundle-schema";
import { useEffect, useRef } from "react";

export interface MarkdownSelection {
  anchor: SourceAnchor2;
  quote: string;
  contextBefore: string;
  contextAfter: string;
}

// Characters of surrounding paper text we lift into the context fields. Stays
// aligned with the bundle builder's ~200-char budget so the plugin-side
// re-anchoring heuristics see a familiar window.
const CONTEXT_CHARS = 200;

interface UseMarkdownSelectionOptions {
  containerRef: { current: HTMLElement | null };
  onSelection: (selection: MarkdownSelection | null) => void;
  // Rising-edge callback: only fires when a new non-empty selection appears,
  // so opening the composer doesn't re-trigger on every mousemove.
}

function textOfContainer(container: HTMLElement): string {
  // Serialise the container's plain text in depth-first order, matching the
  // walk that `selectionToSourceAnchor` uses for char offsets. This keeps
  // `contextBefore` / `contextAfter` aligned with the user's visual span.
  return container.innerText;
}

// Grabs the character offset of a Range endpoint relative to `container`'s
// plain-text serialization.
function offsetWithinContainer(container: HTMLElement, node: Node, nodeOffset: number): number {
  const range = document.createRange();
  range.setStart(container, 0);
  range.setEnd(node, nodeOffset);
  return range.toString().length;
}

export function useMarkdownSelection(options: UseMarkdownSelectionOptions): void {
  const lastQuoteRef = useRef<string>("");

  useEffect(() => {
    function onSelectionChange(): void {
      const container = options.containerRef.current;
      if (!container) return;
      const sel = document.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        if (lastQuoteRef.current !== "") {
          lastQuoteRef.current = "";
          options.onSelection(null);
        }
        return;
      }
      const anchorNode = sel.anchorNode;
      const focusNode = sel.focusNode;
      if (!anchorNode || !focusNode) return;
      if (!container.contains(anchorNode) || !container.contains(focusNode)) return;

      const anchor = selectionToSourceAnchor({
        anchorNode,
        anchorOffset: sel.anchorOffset,
        focusNode,
        focusOffset: sel.focusOffset,
      });
      if (anchor === null) return;

      const quote = sel.toString().trim();
      if (quote === "" || quote === lastQuoteRef.current) return;
      lastQuoteRef.current = quote;

      const full = textOfContainer(container);
      const startOffset = offsetWithinContainer(container, anchorNode, sel.anchorOffset);
      const endOffset = offsetWithinContainer(container, focusNode, sel.focusOffset);
      const [lo, hi] =
        startOffset <= endOffset ? [startOffset, endOffset] : [endOffset, startOffset];

      const contextBefore = full.slice(Math.max(0, lo - CONTEXT_CHARS), lo);
      const contextAfter = full.slice(hi, Math.min(full.length, hi + CONTEXT_CHARS));

      options.onSelection({ anchor, quote, contextBefore, contextAfter });
    }

    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [options]);
}
