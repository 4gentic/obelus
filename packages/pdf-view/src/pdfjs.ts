import type { PDFDocumentProxy } from "pdfjs-dist";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
// The `?worker` import is load-bearing: cross-origin-isolated contexts cannot
// resolve a worker via URL-constructor, but a Vite-bundled worker chunk is same-origin.
import PdfWorker from "pdfjs-dist/build/pdf.worker.mjs?worker";

let initialized = false;

function init(): void {
  if (initialized) return;
  GlobalWorkerOptions.workerPort = new PdfWorker();
  initialized = true;
}

// cMapUrl / standardFontDataUrl point at assets copied by the `prebuild` script
// from `node_modules/pdfjs-dist/` into `public/`. Without these, CJK glyphs and
// any PDF that relies on the 14 standard fonts will render as boxes. The prefix
// is derived from Vite's `BASE_URL` so sub-path deploys (e.g. GitHub Pages)
// resolve correctly; pdf-view has no direct Vite dependency, so `import.meta`
// is narrowed locally rather than via `vite/client`.
function assetBase(): string {
  const env = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
  const raw = env?.BASE_URL ?? "/";
  return raw.endsWith("/") ? raw : `${raw}/`;
}

export async function loadDocument(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  init();
  const base = assetBase();
  const task = getDocument({
    data,
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`,
    isEvalSupported: false,
    verbosity: 0,
  });
  return task.promise;
}
