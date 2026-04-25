import type { HtmlAnchor2, HtmlElementAnchor2, SourceAnchor2 } from "@obelus/bundle-schema";
import { normalizeQuote } from "./anchor";

// See source.ts: hard-coded so these helpers run outside DOM environments.
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

// Tags whose text content is part of the document's bytes but not its
// rendered prose. The view-side walks in `@obelus/html-view` skip the same
// set — both walks must agree, or character offsets shift between anchor
// creation and resolution.
const SKIP_TAGS = new Set(["style", "script", "template", "noscript"]);

function isSkippableElement(node: Node): boolean {
  return node.nodeType === ELEMENT_NODE && SKIP_TAGS.has((node as Element).tagName.toLowerCase());
}

// Walks up from `node` to the nearest ancestor element bearing
// `data-html-file` (the convention rendered .html files use to declare
// themselves). Returns the element + the file name, or null if the node
// is outside any tagged document.
function findHtmlRoot(node: Node | null): { root: HTMLElement; file: string } | null {
  let current: Node | null = node;
  while (current) {
    if (current.nodeType === ELEMENT_NODE) {
      const el = current as HTMLElement;
      const file = el.getAttribute("data-html-file");
      if (file !== null) return { root: el, file };
    }
    current = current.parentNode;
  }
  return null;
}

// Builds a stable, deterministic XPath from `root` to `target`. We use
// 1-indexed positions among same-tag siblings, matching the standard
// `count(preceding-sibling::tag) + 1` convention. Text nodes get
// `text()[N]` indices; elements get `tag[N]`.
function xpathFromRoot(root: HTMLElement, target: Node): string | null {
  if (target === root) return ".";

  const segments: Array<string> = [];
  let current: Node | null = target;
  while (current && current !== root) {
    const parent: ParentNode | null = current.parentNode;
    if (!parent) return null;
    if (current.nodeType === TEXT_NODE) {
      let index = 1;
      let sibling = current.previousSibling;
      while (sibling) {
        if (sibling.nodeType === TEXT_NODE) index += 1;
        sibling = sibling.previousSibling;
      }
      segments.push(`text()[${index}]`);
    } else if (current.nodeType === ELEMENT_NODE) {
      const el = current as HTMLElement;
      const tag = el.tagName.toLowerCase();
      let index = 1;
      let sibling = el.previousSibling;
      while (sibling) {
        if (
          sibling.nodeType === ELEMENT_NODE &&
          (sibling as HTMLElement).tagName.toLowerCase() === tag
        ) {
          index += 1;
        }
        sibling = sibling.previousSibling;
      }
      segments.push(`${tag}[${index}]`);
    } else {
      return null;
    }
    current = parent as Node | null;
  }
  if (current !== root) return null;
  segments.reverse();
  return segments.length === 0 ? "." : `./${segments.join("/")}`;
}

// Counts UTF-16 code units in the concatenated text of `root` up to (and
// excluding) `targetNode`'s `targetOffset`. Symmetric with the source-anchor
// helper, but anchors against the rendered HTML's own text content rather
// than the original file.
function charOffsetInRoot(root: HTMLElement, targetNode: Node, targetOffset: number): number {
  let count = 0;
  let done = false;

  const walk = (node: Node): void => {
    if (done) return;
    if (node === targetNode) {
      if (node.nodeType === TEXT_NODE) count += targetOffset;
      else if (node.nodeType === ELEMENT_NODE) {
        const el = node as HTMLElement;
        for (let i = 0; i < targetOffset && i < el.childNodes.length; i += 1) {
          const child = el.childNodes[i];
          if (child) walk(child);
        }
      }
      done = true;
      return;
    }
    if (node.nodeType === TEXT_NODE) {
      count += node.nodeValue?.length ?? 0;
      return;
    }
    if (node.nodeType === ELEMENT_NODE) {
      if (isSkippableElement(node)) return;
      const el = node as HTMLElement;
      for (let i = 0; i < el.childNodes.length && !done; i += 1) {
        const child = el.childNodes[i];
        if (child) walk(child);
      }
    }
  };

  walk(root);
  return count;
}

export function selectionToHtmlAnchor(
  selection: Pick<Selection, "anchorNode" | "anchorOffset" | "focusNode" | "focusOffset">,
  sourceHint?: SourceAnchor2,
): HtmlAnchor2 | null {
  const { anchorNode, focusNode } = selection;
  if (!anchorNode || !focusNode) return null;

  const startInfo = findHtmlRoot(anchorNode);
  const endInfo = findHtmlRoot(focusNode);
  if (!startInfo || !endInfo) return null;
  if (startInfo.file !== endInfo.file || startInfo.root !== endInfo.root) return null;

  const xpath = xpathFromRoot(startInfo.root, anchorNode);
  if (xpath === null) return null;

  const startOffset = charOffsetInRoot(startInfo.root, anchorNode, selection.anchorOffset);
  const endOffset = charOffsetInRoot(endInfo.root, focusNode, selection.focusOffset);
  const [lo, hi] = startOffset <= endOffset ? [startOffset, endOffset] : [endOffset, startOffset];

  const anchor: HtmlAnchor2 = {
    kind: "html",
    file: startInfo.file,
    xpath,
    charOffsetStart: lo,
    charOffsetEnd: hi,
  };
  if (sourceHint) {
    return { ...anchor, sourceHint };
  }
  return anchor;
}

// Builds an element-only anchor (no char offsets) for a single image element
// inside a `data-html-file`-tagged root. Used when the user clicks an `<img>`
// rather than dragging a text range — the text walk has nothing to anchor to.
export function imageElementToHtmlAnchor(
  img: HTMLElement,
  sourceHint?: SourceAnchor2,
): HtmlElementAnchor2 | null {
  const info = findHtmlRoot(img);
  if (!info) return null;
  const xpath = xpathFromRoot(info.root, img);
  if (xpath === null) return null;
  const anchor: HtmlElementAnchor2 = { kind: "html-element", file: info.file, xpath };
  if (sourceHint) {
    return { ...anchor, sourceHint };
  }
  return anchor;
}

// Round-trips an HtmlAnchor against the rendered HTML root it references.
// The caller passes in the same root the anchor was captured against
// (e.g. the writer-mode preview pane); the verifier walks to the resolved
// node by re-evaluating the XPath, then compares the substring.
export function verifyHtmlAnchor(
  anchor: HtmlAnchor2,
  root: HTMLElement,
  expectedQuote: string,
): { ok: true } | { ok: false; reason: "xpath-miss" | "quote-mismatch" | "out-of-range" } {
  if (anchor.charOffsetStart > anchor.charOffsetEnd) {
    return { ok: false, reason: "out-of-range" };
  }
  const text = collectText(root);
  if (anchor.charOffsetEnd > text.length) {
    return { ok: false, reason: "out-of-range" };
  }
  const slice = text.slice(anchor.charOffsetStart, anchor.charOffsetEnd);
  if (normalizeQuote(slice) !== normalizeQuote(expectedQuote)) {
    return { ok: false, reason: "quote-mismatch" };
  }
  return { ok: true };
}

function collectText(node: Node): string {
  const parts: Array<string> = [];
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
