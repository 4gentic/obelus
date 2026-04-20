import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { TextLayer } from "pdfjs-dist";
import type { JSX } from "react";
import { type ReactNode, useEffect, useRef } from "react";
import { registerTextLayer } from "./selection-anchor";

type Props = {
  doc: PDFDocumentProxy;
  pageIndex: number;
  scale: number;
  // Rendered below the text layer so span selection stays clickable. Coordinates
  // are in scale-1 PDF points; the caller multiplies by `scale` when placing.
  overlay?: ReactNode;
};

export default function PdfPage({ doc, pageIndex, scale, overlay }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let page: PDFPageProxy | null = null;
    let unregister: (() => void) | null = null;

    async function run(): Promise<void> {
      const loaded = await doc.getPage(pageIndex + 1);
      if (cancelled) {
        loaded.cleanup();
        return;
      }
      page = loaded;

      const viewport = loaded.getViewport({ scale });
      const canvas = canvasRef.current;
      const textLayerEl = textLayerRef.current;
      const wrapper = wrapperRef.current;
      if (!canvas || !textLayerEl || !wrapper) return;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      wrapper.style.width = `${viewport.width}px`;
      wrapper.style.height = `${viewport.height}px`;
      // pdfjs 5.x sizes every text-layer span via `--total-scale-factor`
      // (`font-size: calc(var(--text-scale-factor) * var(--font-height))` where
      // `--text-scale-factor` resolves from `--total-scale-factor`). The
      // pdfViewer CSS derives it from `--scale-factor * --user-unit`, but only
      // inside `.pdfViewer .page` — which we don't use. Set both here so spans
      // actually size to the rendered canvas glyphs; otherwise `font-size`
      // falls back to the browser default and drag-selection lands on the
      // wrong spans. Never `transform: scale()` the text layer.
      wrapper.style.setProperty("--scale-factor", String(scale));
      wrapper.style.setProperty("--total-scale-factor", String(scale));

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      renderTask = loaded.render({ canvasContext: ctx, canvas, viewport });
      try {
        await renderTask.promise;
      } catch (err) {
        if (isRenderCancelled(err)) return;
        throw err;
      }
      if (cancelled) return;

      textLayerEl.replaceChildren();
      const textLayer = new TextLayer({
        textContentSource: loaded.streamTextContent(),
        container: textLayerEl,
        viewport,
      });
      await textLayer.render();

      // TextLayer only appends spans for TextItems with non-empty `str` and
      // wraps marked-content runs in a `.markedContent` parent (no `str` of
      // its own). Exclude those wrappers so our `data-item-index` numbering
      // matches the content stream filtered by the same predicate on the
      // selection/extract side.
      const spans = textLayerEl.querySelectorAll<HTMLElement>("span:not(.markedContent)");
      for (let i = 0; i < spans.length; i += 1) {
        const el = spans[i];
        if (el) el.setAttribute("data-item-index", String(i));
      }

      // Install pdfjs's selection-anchor sink. Must run AFTER data-item-index
      // is assigned (the sink is appended last and should not be counted).
      unregister = registerTextLayer(textLayerEl);
    }

    void run();

    return () => {
      cancelled = true;
      if (unregister) unregister();
      if (renderTask) renderTask.cancel();
      if (page) page.cleanup();
    };
  }, [doc, pageIndex, scale]);

  return (
    <div ref={wrapperRef} className="pdf-page" data-page-index={pageIndex}>
      <canvas ref={canvasRef} className="pdf-page__canvas" />
      {overlay ? <div className="pdf-page__overlay">{overlay}</div> : null}
      <div ref={textLayerRef} className="pdf-page__text textLayer" />
    </div>
  );
}

function isRenderCancelled(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as { name: unknown }).name === "RenderingCancelledException"
  );
}
