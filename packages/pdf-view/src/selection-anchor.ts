// Pdfjs's TextLayerBuilder ships an `.endOfContent` sink plus a `selectionchange`
// listener that repositions the sink next to the drag anchor. Without this
// machinery, browsers extend drag-selections in an absolutely-positioned text
// layer to the end of the parent — dragging across a font-switch boundary on
// one visual line captures the rest of the line. We use the bare `TextLayer`
// class (the lower-level primitive), so we have to replicate the mechanism
// ourselves. This module is a direct port of pdfjs's logic so the behavior
// matches what users see in the standard pdfjs viewer.
//
// `PdfDocument` mounts every page eagerly, so `textLayers` accumulates one
// entry per page. The naïve port mutated every layer on every selectionchange,
// which on a 30-page paper meant ~60 unconditional class+style writes per
// event × ~30 events/sec — enough forced layout to make drag-selection feel
// laggy. The version below tracks the active set, mutates only the symmetric
// difference, and bails when the range hasn't actually changed between fires.

const textLayers = new Map<HTMLElement, HTMLElement>();
const activeLayers = new Set<HTMLElement>();
let listenersInstalled = false;
let prevRange: Range | null = null;
let prevRangeCount = 0;
let prevAnchorEl: Element | null = null;
let prevAnchorAtStart = false;

function reset(end: HTMLElement, textLayer: HTMLElement): void {
  // `Node.append()` of an already-attached child still runs the spec's
  // remove-then-insert, which invalidates style on the parent. Skip the
  // writes when the sink is already in its parking position.
  if (
    end.parentNode === textLayer &&
    textLayer.lastChild === end &&
    end.style.width === "" &&
    end.style.height === ""
  ) {
    if (textLayer.classList.contains("selecting")) textLayer.classList.remove("selecting");
    return;
  }
  textLayer.append(end);
  end.style.width = "";
  end.style.height = "";
  textLayer.classList.remove("selecting");
}

function clearAll(): void {
  for (const tl of activeLayers) {
    const end = textLayers.get(tl);
    if (end) reset(end, tl);
  }
  activeLayers.clear();
  prevRange = null;
  prevRangeCount = 0;
  prevAnchorEl = null;
  prevAnchorAtStart = false;
}

function installListeners(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;

  let isPointerDown = false;
  document.addEventListener("pointerdown", () => {
    isPointerDown = true;
  });
  const onPointerUp = (): void => {
    isPointerDown = false;
    clearAll();
  };
  document.addEventListener("pointerup", onPointerUp);
  window.addEventListener("blur", onPointerUp);
  document.addEventListener("keyup", () => {
    if (!isPointerDown) clearAll();
  });

  document.addEventListener("selectionchange", () => {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) {
      if (activeLayers.size === 0 && prevRange === null) return;
      clearAll();
      return;
    }

    const range0 = selection.getRangeAt(0);

    // Browsers re-fire `selectionchange` on focus and other transitions that
    // don't move the range. Skip those entirely.
    if (
      prevRange !== null &&
      selection.rangeCount === prevRangeCount &&
      range0.compareBoundaryPoints(Range.START_TO_START, prevRange) === 0 &&
      range0.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0
    ) {
      return;
    }

    // O(deltaPages) instead of O(allPages): only flip class state on layers
    // crossing into or out of the selection. Idle pages never see a write.
    const nextActive = new Set<HTMLElement>();
    for (let i = 0; i < selection.rangeCount; i += 1) {
      const range = selection.getRangeAt(i);
      for (const tl of textLayers.keys()) {
        if (!nextActive.has(tl) && range.intersectsNode(tl)) nextActive.add(tl);
      }
    }
    for (const tl of activeLayers) {
      if (!nextActive.has(tl)) {
        const end = textLayers.get(tl);
        if (end) reset(end, tl);
      }
    }
    for (const tl of nextActive) {
      if (!activeLayers.has(tl)) tl.classList.add("selecting");
    }
    activeLayers.clear();
    for (const tl of nextActive) activeLayers.add(tl);

    const modifyStart =
      prevRange !== null &&
      (range0.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 ||
        range0.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0);
    let anchorNode: Node = modifyStart ? range0.startContainer : range0.endContainer;
    if (anchorNode.nodeType === Node.TEXT_NODE && anchorNode.parentNode) {
      anchorNode = anchorNode.parentNode;
    }
    const anchorEl = anchorNode instanceof Element ? anchorNode : null;
    const parentTextLayer = anchorEl?.parentElement?.closest<HTMLElement>(".textLayer") ?? null;

    // The browser fires multiple selectionchanges as the same Range extends
    // within one span; the sink only needs to move when the anchor span
    // changes.
    const anchorUnchanged =
      anchorEl !== null && anchorEl === prevAnchorEl && modifyStart === prevAnchorAtStart;

    if (parentTextLayer && anchorEl?.parentNode && !anchorUnchanged) {
      const end = textLayers.get(parentTextLayer);
      if (end) {
        end.style.width = parentTextLayer.style.width;
        end.style.height = parentTextLayer.style.height;
        anchorEl.parentNode.insertBefore(end, modifyStart ? anchorEl : anchorEl.nextSibling);
      }
    }

    prevRange = range0.cloneRange();
    prevRangeCount = selection.rangeCount;
    prevAnchorEl = anchorEl;
    prevAnchorAtStart = modifyStart;
  });
}

export function registerTextLayer(textLayerEl: HTMLElement): () => void {
  installListeners();

  const endOfContent = document.createElement("div");
  endOfContent.className = "endOfContent";
  textLayerEl.append(endOfContent);
  textLayers.set(textLayerEl, endOfContent);

  const onMouseDown = (): void => {
    textLayerEl.classList.add("selecting");
    // Track this layer as active so the next selectionchange's diff can clear
    // the class if the drag ends up elsewhere.
    activeLayers.add(textLayerEl);
  };
  textLayerEl.addEventListener("mousedown", onMouseDown);

  return () => {
    textLayerEl.removeEventListener("mousedown", onMouseDown);
    textLayers.delete(textLayerEl);
    activeLayers.delete(textLayerEl);
    if (endOfContent.parentNode) endOfContent.parentNode.removeChild(endOfContent);
  };
}
