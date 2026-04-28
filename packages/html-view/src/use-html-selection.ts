import {
  findImageTarget,
  imageElementToHtmlAnchor,
  imageElementToSourceAnchor,
  quoteForImage,
  selectionToHtmlAnchor,
  selectionToSourceAnchor,
} from "@obelus/anchor";
import type { HtmlAnchor, HtmlElementAnchor, SourceAnchor } from "@obelus/bundle-schema";
import { useEffect, useRef } from "react";

export type HtmlSelectionAnchor =
  | {
      kind: "source";
      anchor: SourceAnchor;
      quote: string;
      contextBefore: string;
      contextAfter: string;
    }
  | {
      kind: "html";
      anchor: HtmlAnchor;
      quote: string;
      contextBefore: string;
      contextAfter: string;
    }
  | {
      kind: "html-element";
      anchor: HtmlElementAnchor;
      quote: string;
      contextBefore: string;
      contextAfter: string;
    };

export interface UseHtmlSelectionOptions {
  // Wrapper element rendered by the parent. The hook reads its
  // `ownerDocument` as a fallback when `mountRef` is not yet available
  // (the iframe hasn't loaded).
  hostRef: { current: HTMLElement | null };
  // The body of the iframe document that contains the rendered paper.
  // The hook listens for `selectionchange` on the mount's owner document
  // (the iframe doc) once it appears, and computes anchors against it.
  mountRef: { current: HTMLElement | null };
  file: string;
  mode: "source" | "html";
  sourceFile?: string;
  // Bumped by the adapter when the iframe loads (so the mount document
  // becomes reachable). Without it, the listener-attaching effect runs
  // only on the initial mount — before the iframe is ready — and the
  // listener is bound to the wrong document.
  mountVersion: number;
  onSelection: (selection: HtmlSelectionAnchor | null) => void;
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CONTEXT_CHARS = 200;

// Tags whose text content is part of the document's bytes but not its
// rendered prose. Must agree with the sets in `@obelus/anchor` and
// `highlights.ts` — anchor offsets shift if the walks disagree.
const SKIP_TAGS = new Set(["style", "script", "template", "noscript"]);

function isSkippableElement(node: Node): boolean {
  return node.nodeType === ELEMENT_NODE && SKIP_TAGS.has((node as Element).tagName.toLowerCase());
}

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
      if (isSkippableElement(n)) return;
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

// Symmetric with `collectText` and `charOffsetInRoot` in `@obelus/anchor`:
// counts UTF-16 code units in the same skip-aware walk up to `targetNode`'s
// `targetOffset`. We can't use `Range.toString().length` here because native
// ranges include `<style>`/`<script>` text content, which would shift the
// offsets relative to anchor creation.
function charOffsetUpTo(root: HTMLElement, targetNode: Node, targetOffset: number): number {
  let count = 0;
  let done = false;
  const walk = (n: Node): void => {
    if (done) return;
    if (n === targetNode) {
      if (n.nodeType === TEXT_NODE) {
        count += targetOffset;
      } else if (n.nodeType === ELEMENT_NODE) {
        const el = n as HTMLElement;
        for (let i = 0; i < targetOffset && i < el.childNodes.length; i += 1) {
          const child = el.childNodes[i];
          if (child) walk(child);
        }
      }
      done = true;
      return;
    }
    if (n.nodeType === TEXT_NODE) {
      count += n.nodeValue?.length ?? 0;
      return;
    }
    if (n.nodeType === ELEMENT_NODE) {
      if (isSkippableElement(n)) return;
      const el = n as HTMLElement;
      for (let i = 0; i < el.childNodes.length && !done; i += 1) {
        const child = el.childNodes[i];
        if (child) walk(child);
      }
    }
  };
  walk(root);
  return count;
}

function rangeContextFromRoot(
  root: HTMLElement,
  range: Range,
): { contextBefore: string; contextAfter: string } {
  const text = collectText(root);
  const beforeLen = charOffsetUpTo(root, range.startContainer, range.startOffset);
  const afterStart = charOffsetUpTo(root, range.endContainer, range.endOffset);
  return {
    contextBefore: text.slice(Math.max(0, beforeLen - CONTEXT_CHARS), beforeLen),
    contextAfter: text.slice(afterStart, Math.min(text.length, afterStart + CONTEXT_CHARS)),
  };
}

// When the mount lives in an iframe document (the production path), call
// `getSelection()` on the iframe's window — that's where the user's
// selection actually is. The parent document's selection is a separate,
// usually-empty Selection object. Falls back to the host's owner document
// for legacy / test environments where the mount lives in the parent doc.
function pickSelection(host: HTMLElement, mount: HTMLElement): Selection | null {
  const mountDoc = mount.ownerDocument;
  if (mountDoc && mountDoc !== host.ownerDocument) {
    return mountDoc.defaultView?.getSelection() ?? null;
  }
  return host.ownerDocument?.getSelection() ?? null;
}

// Builds an image-click anchor — a click is treated as a selection in its
// own right, but the Selection API wouldn't help here: clicking an `<img>`
// produces a collapsed range that fails the existing text gate. We bypass it
// and synthesise the anchor + a non-empty quote (alt text or filename).
//
// In paired-source mode (md/tex preview rendered to HTML), if the image's
// parent block carries `data-src-file` we prefer a `SourceAnchor` so the
// bundle's downstream consumers (plugin, plan-fix) get line:col coordinates
// for free. Otherwise the anchor is `html-element`.
export function computeImageClickAnchor(
  mount: HTMLElement,
  img: HTMLElement,
): HtmlSelectionAnchor | null {
  if (!mount.contains(img)) return null;
  const quote = quoteForImage(img);
  if (quote === "") return null;
  const sourceAnchor = imageElementToSourceAnchor(img);
  if (sourceAnchor) {
    return {
      kind: "source",
      anchor: sourceAnchor,
      quote,
      contextBefore: "",
      contextAfter: "",
    };
  }
  const elementAnchor = imageElementToHtmlAnchor(img);
  if (!elementAnchor) return null;
  return {
    kind: "html-element",
    anchor: elementAnchor,
    quote,
    contextBefore: "",
    contextAfter: "",
  };
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
  const { hostRef, mountRef, mode, sourceFile, mountVersion, onSelection } = options;
  const onSelectionRef = useRef(onSelection);
  onSelectionRef.current = onSelection;
  const lastQuoteRef = useRef<string>("");
  // Mirrors `lastQuoteRef` but stores only the bare quote text (not the
  // `img:...` dedup key), so the copy listener below can write the actual
  // selected text to the clipboard when the user presses Cmd+C inside the
  // sandboxed iframe.
  const copyQuoteRef = useRef<string>("");
  // Dedup against the native Selection's 4-tuple. `selectionchange` re-fires
  // on focus and scroll without moving the range; without this gate, the
  // full-DOM `collectText(mount)` walk inside `rangeContextFromRoot` runs on
  // every redundant event.
  const lastNativeAnchorNode = useRef<Node | null>(null);
  const lastNativeAnchorOffset = useRef<number>(-1);
  const lastNativeFocusNode = useRef<Node | null>(null);
  const lastNativeFocusOffset = useRef<number>(-1);

  // biome-ignore lint/correctness/useExhaustiveDependencies: mountVersion is the intentional re-trigger — the iframe loads asynchronously, so the listener must re-attach to the iframe document once mountRef.current points there.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const mount = mountRef.current;
    // Attach to both the host's document and (when distinct) the mount's
    // document. Browsers vary on whether `selectionchange` fires inside a
    // same-origin iframe, on the parent, or both — listening on both
    // means we always hear the user's selection regardless of which side
    // the UA fires on. `pickSelection` then resolves to the right
    // Selection object based on where the mount lives.
    const docs: Document[] = [];
    if (host.ownerDocument) docs.push(host.ownerDocument);
    if (mount?.ownerDocument && mount.ownerDocument !== host.ownerDocument) {
      docs.push(mount.ownerDocument);
    }
    if (docs.length === 0) return;
    // WebKit (Tauri on macOS) does not reliably fire `selectionchange`
    // *during* drag inside a same-origin iframe — only at focus
    // transitions. Without a `mouseup`/`pointerup` fallback, a drag-
    // release inside the iframe leaves the captured anchor stale until
    // the user clicks somewhere outside the panel. Both events are
    // pointer-release signals; either alone would close the gap, but
    // attaching both keeps us robust across UA differences (touch vs
    // mouse, older WebKit, etc.).
    const REFRESH_EVENTS = ["selectionchange", "mouseup", "pointerup"] as const;

    // The click handler runs in the iframe's document (where the user's
    // pointer actually is) plus the parent document (legacy/test paths
    // where the mount lives in the parent doc). It walks up from the click
    // target to the nearest <img>; non-image clicks pass through unchanged
    // so author scripts (canvas, svg, etc.) keep working.
    //
    // `instanceof Node` is intentionally avoided: the iframe and parent
    // each own a separate `Node` constructor, so cross-realm `instanceof`
    // checks return false for the very nodes we care about. Duck-type the
    // numeric `nodeType` instead.
    function onClick(ev: Event): void {
      const liveMount = mountRef.current;
      if (!liveMount) return;
      const target = ev.target as { nodeType?: unknown } | null;
      if (!target || typeof target.nodeType !== "number") return;
      const img = findImageTarget(target as Node);
      if (!img || !liveMount.contains(img)) return;
      const result = computeImageClickAnchor(liveMount, img);
      if (result === null) return;
      const dedupKey =
        result.kind === "source"
          ? `img:source:${result.anchor.file}:${result.anchor.lineStart}:${result.quote}`
          : `img:${result.kind}:${result.anchor.xpath}:${result.quote}`;
      if (dedupKey === lastQuoteRef.current) return;
      lastQuoteRef.current = dedupKey;
      copyQuoteRef.current = result.quote;
      onSelectionRef.current(result);
    }

    function onSelectionChange(): void {
      const liveHost = hostRef.current;
      const liveMount = mountRef.current;
      if (!liveHost || !liveMount) return;
      const sel = pickSelection(liveHost, liveMount);
      if (!sel) return;
      if (
        sel.anchorNode === lastNativeAnchorNode.current &&
        sel.anchorOffset === lastNativeAnchorOffset.current &&
        sel.focusNode === lastNativeFocusNode.current &&
        sel.focusOffset === lastNativeFocusOffset.current
      ) {
        return;
      }
      lastNativeAnchorNode.current = sel.anchorNode;
      lastNativeAnchorOffset.current = sel.anchorOffset;
      lastNativeFocusNode.current = sel.focusNode;
      lastNativeFocusOffset.current = sel.focusOffset;
      const result = computeHtmlSelectionAnchor(liveMount, sel, mode, sourceFile);
      if (result === null) {
        // Don't nuke an image-click draft. Clicking an `<img>` produces a
        // collapsed Selection (or none), which would otherwise look like
        // "the user just cleared their text selection".
        if (lastQuoteRef.current !== "" && !lastQuoteRef.current.startsWith("img:")) {
          lastQuoteRef.current = "";
          copyQuoteRef.current = "";
          onSelectionRef.current(null);
        }
        return;
      }
      if (result.quote === lastQuoteRef.current) return;
      lastQuoteRef.current = result.quote;
      copyQuoteRef.current = result.quote;
      onSelectionRef.current(result);
    }
    function onCopy(ev: ClipboardEvent): void {
      const liveMount = mountRef.current;
      if (!liveMount) return;
      const quote = copyQuoteRef.current;
      if (quote === "") return;
      // Resolve the live Selection from whichever document fired this copy.
      // The user's selection lives in the iframe doc when the mount is
      // iframed; the parent doc otherwise. We only override the clipboard
      // when the selection's commonAncestor is inside our mount, so author
      // pages outside the paper aren't affected.
      const evDoc = ev.target instanceof Document ? ev.target : null;
      const win = evDoc?.defaultView ?? null;
      const sel = win?.getSelection() ?? evDoc?.getSelection() ?? null;
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      const range = sel.getRangeAt(0);
      if (!liveMount.contains(range.commonAncestorContainer)) return;
      ev.clipboardData?.setData("text/plain", quote);
      ev.preventDefault();
    }
    for (const d of docs) {
      for (const evt of REFRESH_EVENTS) {
        d.addEventListener(evt, onSelectionChange);
      }
      // Capture-phase click so we see the event before any author handlers
      // can `stopPropagation()` (interactive HTML papers love to do this).
      // We don't `preventDefault`, so the iframe's own listeners still run.
      d.addEventListener("click", onClick, true);
      d.addEventListener("copy", onCopy);
    }
    return () => {
      for (const d of docs) {
        for (const evt of REFRESH_EVENTS) {
          d.removeEventListener(evt, onSelectionChange);
        }
        d.removeEventListener("click", onClick, true);
        d.removeEventListener("copy", onCopy);
      }
    };
  }, [hostRef, mountRef, mode, sourceFile, mountVersion]);
}
