import { selectionToHtmlAnchor, selectionToSourceAnchor } from "@obelus/anchor";
import type { HtmlAnchor2, SourceAnchor2 } from "@obelus/bundle-schema";
import { useEffect, useRef } from "react";

export type HtmlSelectionAnchor =
  | {
      kind: "source";
      anchor: SourceAnchor2;
      quote: string;
      contextBefore: string;
      contextAfter: string;
    }
  | {
      kind: "html";
      anchor: HtmlAnchor2;
      quote: string;
      contextBefore: string;
      contextAfter: string;
    };

export interface UseHtmlSelectionOptions {
  // Light-DOM host element. The hook listens on the host's owner document
  // for `selectionchange` and uses `mountRef` to resolve the shadow-root
  // mount when computing the actual anchor.
  hostRef: { current: HTMLElement | null };
  // The element inside the shadow root that contains the rendered paper.
  // Closed shadow roots aren't reachable from `host.shadowRoot`, so the
  // adapter threads this through via the `HtmlViewHandle`.
  mountRef: { current: HTMLElement | null };
  file: string;
  mode: "source" | "html";
  sourceFile?: string;
  onSelection: (selection: HtmlSelectionAnchor | null) => void;
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CONTEXT_CHARS = 200;

function hasDataSrcAncestor(node: Node | null): boolean {
  let cur: Node | null = node;
  while (cur) {
    if (cur.nodeType === ELEMENT_NODE && (cur as HTMLElement).hasAttribute("data-src-file")) {
      return true;
    }
    cur = cur.parentNode;
  }
  return false;
}

function collectText(node: Node): string {
  const parts: string[] = [];
  const walk = (n: Node): void => {
    if (n.nodeType === TEXT_NODE) {
      parts.push(n.nodeValue ?? "");
      return;
    }
    if (n.nodeType === ELEMENT_NODE) {
      const el = n as HTMLElement;
      for (let i = 0; i < el.childNodes.length; i += 1) {
        const child = el.childNodes[i];
        if (child) walk(child);
      }
    }
  };
  walk(node);
  return parts.join("");
}

function rangeContextFromRoot(
  root: HTMLElement,
  range: Range,
): { contextBefore: string; contextAfter: string } {
  const text = collectText(root);
  const before = root.ownerDocument?.createRange();
  const after = root.ownerDocument?.createRange();
  if (!before || !after) return { contextBefore: "", contextAfter: "" };
  before.setStart(root, 0);
  before.setEnd(range.startContainer, range.startOffset);
  after.setStart(range.endContainer, range.endOffset);
  after.setEnd(root, root.childNodes.length);
  const beforeLen = before.toString().length;
  const afterStart = beforeLen + range.toString().length;
  return {
    contextBefore: text.slice(Math.max(0, beforeLen - CONTEXT_CHARS), beforeLen),
    contextAfter: text.slice(afterStart, Math.min(text.length, afterStart + CONTEXT_CHARS)),
  };
}

// Some browsers expose `getSelection()` on closed ShadowRoots; others only
// expose it on Document. We probe the shadow root first so the more accurate
// (in-shadow) selection wins when available.
type ShadowGetSelection = ShadowRoot & {
  getSelection?: () => Selection | null;
};

function pickSelection(host: HTMLElement, mount: HTMLElement): Selection | null {
  const root = mount.getRootNode();
  if (root && root !== host.ownerDocument) {
    const sgs = root as ShadowGetSelection;
    if (typeof sgs.getSelection === "function") {
      const sel = sgs.getSelection();
      if (sel && sel.rangeCount > 0) return sel;
    }
  }
  return host.ownerDocument?.getSelection() ?? null;
}

export function computeHtmlSelectionAnchor(
  mount: HTMLElement,
  selection: Selection,
  mode: "source" | "html",
  sourceFile: string | undefined,
): HtmlSelectionAnchor | null {
  if (selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!mount.contains(range.startContainer) || !mount.contains(range.endContainer)) {
    return null;
  }
  const quote = range.toString().trim();
  if (quote === "") return null;
  const ctx = rangeContextFromRoot(mount, range);
  const useSource = hasDataSrcAncestor(range.startContainer);
  if (useSource) {
    const sourceAnchor = selectionToSourceAnchor({
      anchorNode: range.startContainer,
      anchorOffset: range.startOffset,
      focusNode: range.endContainer,
      focusOffset: range.endOffset,
    });
    if (sourceAnchor) {
      return { kind: "source", anchor: sourceAnchor, quote, ...ctx };
    }
  }
  const htmlAnchor = selectionToHtmlAnchor({
    anchorNode: range.startContainer,
    anchorOffset: range.startOffset,
    focusNode: range.endContainer,
    focusOffset: range.endOffset,
  });
  if (!htmlAnchor) return null;
  // The anchor's file must match the mount's `data-html-file`. If a
  // sourceHint is appropriate (paired-source mode with no embedded
  // data-src-* on the actual selection), the caller can layer it on later.
  void mode;
  void sourceFile;
  return { kind: "html", anchor: htmlAnchor, quote, ...ctx };
}

export function useHtmlSelection(options: UseHtmlSelectionOptions): void {
  const { hostRef, mountRef, mode, sourceFile, onSelection } = options;
  const onSelectionRef = useRef(onSelection);
  onSelectionRef.current = onSelection;
  const lastQuoteRef = useRef<string>("");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const doc = host.ownerDocument;
    if (!doc) return;
    function onSelectionChange(): void {
      const liveHost = hostRef.current;
      const liveMount = mountRef.current;
      if (!liveHost || !liveMount) return;
      const sel = pickSelection(liveHost, liveMount);
      if (!sel) return;
      const result = computeHtmlSelectionAnchor(liveMount, sel, mode, sourceFile);
      if (result === null) {
        if (lastQuoteRef.current !== "") {
          lastQuoteRef.current = "";
          onSelectionRef.current(null);
        }
        return;
      }
      if (result.quote === lastQuoteRef.current) return;
      lastQuoteRef.current = result.quote;
      onSelectionRef.current(result);
    }
    doc.addEventListener("selectionchange", onSelectionChange);
    return () => doc.removeEventListener("selectionchange", onSelectionChange);
  }, [hostRef, mountRef, mode, sourceFile]);
}
