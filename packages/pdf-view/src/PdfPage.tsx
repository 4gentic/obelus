import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { TextLayer } from "pdfjs-dist";
import type { TextItem, TextMarkedContent } from "pdfjs-dist/types/src/display/api";
import type { JSX } from "react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { clearPageItems, setPageItems } from "./page-items";
import { registerTextLayer } from "./selection-anchor";

// Tee pdfjs's text-content stream so we can capture the exact TextItems
// TextLayer consumes, while forwarding chunks to it unchanged. Calling
// `page.getTextContent()` independently is NOT equivalent — we've observed
// the two streams produce items at different indices for some PDFs, which
// is what made `items[i]` not match the span at `data-item-index=i`.
function teeTextStream(
  source: ReadableStream<{
    items: Array<TextItem | TextMarkedContent>;
    styles: unknown;
    lang: string | null;
  }>,
  capture: Array<TextItem | TextMarkedContent>,
): ReadableStream {
  const reader = source.getReader();
  return new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        for (const item of value.items) capture.push(item);
        controller.enqueue(value);
      } catch (err) {
        controller.error(err);
      }
    },
    cancel(reason) {
      reader.cancel(reason).catch(() => {});
    },
  });
}

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

  const [isRenderable, setIsRenderable] = useState(false);
  const lastRasterRef = useRef<RenderKey | null>(null);

  // Viewport-rooted observer. Intermediate `overflow:auto` ancestors
  // (`.project-shell__center` on desktop, `.review__scroll` on web) still
  // clip the intersection rect, so pages scrolled out of the pane report
  // zero intersection. A 1-viewport vertical `rootMargin` starts the raster
  // one pane-height before the page enters view so the user never sees the
  // stale bitmap.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setIsRenderable(entry.isIntersecting);
      },
      { root: null, rootMargin: "100% 0px", threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Text-layer effect. Gated on `isRenderable` so a long PDF doesn't fan out
  // 30+ parallel `streamTextContent()` pumps on initial mount — that work
  // monopolizes the main thread for the first few seconds, queueing the
  // user's first click behind it and producing a visible "stuck" feeling
  // before the very first selection.
  //
  // The teardown race the previous version warned about (two `TextLayer`s
  // interleaving `append()` on the same container if the effect re-ran
  // mid-render) is contained by `cancelled` + `textLayer.cancel()` in the
  // cleanup, plus `textLayerEl.replaceChildren()` at the start of each new
  // run wiping any stragglers from a cancelled pump.
  useEffect(() => {
    if (!isRenderable) return;
    let cancelled = false;
    let textLayer: TextLayer | null = null;
    let unregister: (() => void) | null = null;
    let page: PDFPageProxy | null = null;

    async function run(): Promise<void> {
      const loaded = await doc.getPage(pageIndex + 1);
      if (cancelled) return;
      page = loaded;

      const viewport = loaded.getViewport({ scale });
      const textLayerEl = textLayerRef.current;
      const wrapper = wrapperRef.current;
      if (!textLayerEl || !wrapper) return;

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

      textLayerEl.replaceChildren();

      // Tee the stream so the items pdfjs consumes are captured here,
      // guaranteeing `capturedRaw[i]` is the same item that produced the
      // i-th span pdfjs appended.
      const capturedRaw: Array<TextItem | TextMarkedContent> = [];
      const teed = teeTextStream(
        loaded.streamTextContent() as ReadableStream<{
          items: Array<TextItem | TextMarkedContent>;
          styles: unknown;
          lang: string | null;
        }>,
        capturedRaw,
      );
      textLayer = new TextLayer({
        textContentSource: teed,
        container: textLayerEl,
        viewport,
      });
      try {
        await textLayer.render();
      } catch {
        // textLayer.cancel() rejects the capability with AbortException; swallow
        // it since the cleanup path below owns teardown.
        return;
      }
      if (cancelled) return;

      // Match pdfjs's TextLayer `#appendText` rule: a DOM span is appended
      // for every item with `str` defined AND non-empty. Marked-content
      // markers (no `str`) are handled via wrapper `<span class="markedContent">`
      // which our selector excludes. Empty-string items create a textDiv
      // internally (counted in `textLayer.textDivs`) but are NOT appended
      // to the DOM, so they don't appear in querySelectorAll results.
      const capturedItems: TextItem[] = capturedRaw.filter(
        (x: TextItem | TextMarkedContent): x is TextItem => "str" in x && x.str !== "",
      );

      const spans = textLayerEl.querySelectorAll<HTMLElement>("span:not(.markedContent)");
      for (let i = 0; i < spans.length; i += 1) {
        const el = spans[i];
        if (el) el.setAttribute("data-item-index", String(i));
      }

      // Publish the captured items — these came from the same stream the
      // TextLayer consumed, so `capturedItems[i]` corresponds to the span
      // at `data-item-index=i`.
      setPageItems(wrapper, capturedItems);

      // Install pdfjs's selection-anchor sink. Must run AFTER data-item-index
      // is assigned (the sink is appended last and should not be counted).
      unregister = registerTextLayer(textLayerEl);
    }

    void run();

    return () => {
      cancelled = true;
      // Cancel the pump first so it stops appending to the DOM, then drop the
      // registration and the captured-items entry. `page.cleanup()` would fail
      // if the stream is still in flight, so order matters.
      if (textLayer) {
        textLayer.cancel();
        textLayer = null;
      }
      if (unregister) {
        unregister();
        unregister = null;
      }
      const wrapper = wrapperRef.current;
      if (wrapper) clearPageItems(wrapper);
      if (page) page.cleanup();
    };
  }, [doc, pageIndex, scale, isRenderable]);

  // Raster effect. Paints the canvas when the page enters the renderable band.
  // Independent of the text-layer effect so visibility flips don't disturb the
  // text-layer DOM (see comment on that effect for the race this avoids).
  useEffect(() => {
    if (!isRenderable) return;
    if (matchesKey(lastRasterRef.current, doc, pageIndex, scale)) return;

    let cancelled = false;
    let renderTask: RenderTask | null = null;

    async function run(): Promise<void> {
      const loaded = await doc.getPage(pageIndex + 1);
      if (cancelled) return;

      const viewport = loaded.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas) return;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

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
      lastRasterRef.current = { doc, pageIndex, scale };
    }

    void run();

    return () => {
      cancelled = true;
      if (renderTask) renderTask.cancel();
    };
  }, [doc, pageIndex, scale, isRenderable]);

  return (
    <div ref={wrapperRef} className="pdf-page" data-page-index={pageIndex}>
      <canvas ref={canvasRef} className="pdf-page__canvas" />
      {overlay ? <div className="pdf-page__overlay">{overlay}</div> : null}
      <div ref={textLayerRef} className="pdf-page__text textLayer" />
    </div>
  );
}

type RenderKey = { doc: PDFDocumentProxy; pageIndex: number; scale: number };

function matchesKey(
  key: RenderKey | null,
  doc: PDFDocumentProxy,
  pageIndex: number,
  scale: number,
): boolean {
  return key !== null && key.doc === doc && key.pageIndex === pageIndex && key.scale === scale;
}

function isRenderCancelled(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as { name: unknown }).name === "RenderingCancelledException"
  );
}
