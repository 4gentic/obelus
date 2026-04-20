// Pdfjs's TextLayerBuilder ships an `.endOfContent` sink plus a `selectionchange`
// listener that repositions the sink next to the drag anchor. Without this
// machinery, browsers extend drag-selections in an absolutely-positioned text
// layer to the end of the parent — dragging across a font-switch boundary on
// one visual line captures the rest of the line. We use the bare `TextLayer`
// class (the lower-level primitive), so we have to replicate the mechanism
// ourselves. This module is a direct port of pdfjs's logic so the behavior
// matches what users see in the standard pdfjs viewer.

const textLayers = new Map<HTMLElement, HTMLElement>();
let listenersInstalled = false;
let prevRange: Range | null = null;

function reset(end: HTMLElement, textLayer: HTMLElement): void {
  textLayer.append(end);
  end.style.width = "";
  end.style.height = "";
  textLayer.classList.remove("selecting");
}

function installListeners(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;

  let isPointerDown = false;
  document.addEventListener("pointerdown", () => {
    isPointerDown = true;
  });
  const resetAll = (): void => {
    isPointerDown = false;
    for (const [tl, end] of textLayers) reset(end, tl);
  };
  document.addEventListener("pointerup", resetAll);
  window.addEventListener("blur", resetAll);
  document.addEventListener("keyup", () => {
    if (!isPointerDown) for (const [tl, end] of textLayers) reset(end, tl);
  });

  document.addEventListener("selectionchange", () => {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) {
      for (const [tl, end] of textLayers) reset(end, tl);
      return;
    }

    const active = new Set<HTMLElement>();
    for (let i = 0; i < selection.rangeCount; i += 1) {
      const range = selection.getRangeAt(i);
      for (const tl of textLayers.keys()) {
        if (!active.has(tl) && range.intersectsNode(tl)) active.add(tl);
      }
    }
    for (const [tl, end] of textLayers) {
      if (active.has(tl)) tl.classList.add("selecting");
      else reset(end, tl);
    }

    const range = selection.getRangeAt(0);
    const modifyStart =
      prevRange !== null &&
      (range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 ||
        range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0);
    let anchorNode: Node = modifyStart ? range.startContainer : range.endContainer;
    if (anchorNode.nodeType === Node.TEXT_NODE && anchorNode.parentNode) {
      anchorNode = anchorNode.parentNode;
    }
    const anchorEl = anchorNode instanceof Element ? anchorNode : null;
    const parentTextLayer = anchorEl?.parentElement?.closest<HTMLElement>(".textLayer") ?? null;
    if (parentTextLayer && anchorEl?.parentNode) {
      const end = textLayers.get(parentTextLayer);
      if (end) {
        end.style.width = parentTextLayer.style.width;
        end.style.height = parentTextLayer.style.height;
        anchorEl.parentNode.insertBefore(end, modifyStart ? anchorEl : anchorEl.nextSibling);
      }
    }
    prevRange = range.cloneRange();
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
  };
  textLayerEl.addEventListener("mousedown", onMouseDown);

  return () => {
    textLayerEl.removeEventListener("mousedown", onMouseDown);
    textLayers.delete(textLayerEl);
    if (endOfContent.parentNode) endOfContent.parentNode.removeChild(endOfContent);
  };
}
