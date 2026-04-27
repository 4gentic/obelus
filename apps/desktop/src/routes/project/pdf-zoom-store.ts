import { useCallback, useSyncExternalStore } from "react";

// Per-paper zoom override. `null` (or absent) means "auto-fit to column width",
// the default behaviour usePdfDocumentView reverts to. A number is the
// effective absolute scale: 1.25 == 100% display zoom (matches BASE_SCALE in
// the adapter). Lives in-memory only — the plan keeps zoom session-scoped,
// like Preview.app.
//
// `autoScaleByPaper` mirrors the adapter's measured fit-to-width scale per
// paper. Without this, stepping from `BASE_SCALE` would land *below* the live
// auto-fit on wide screens (autoScale up to FIT_MAX_SCALE = 2.0), and the
// first "+" click from Auto would visibly shrink the PDF.
const zoomByPaper = new Map<string, number>();
const autoScaleByPaper = new Map<string, number>();
const toolByPaper = new Map<string, PdfTool>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const cb of listeners) cb();
}

export const PDF_ZOOM_BASE = 1.25;
export const PDF_ZOOM_MIN = 0.5;
export const PDF_ZOOM_MAX = 3;
export const PDF_ZOOM_STEP = 0.15;

export type PdfTool = "select" | "pan";

export function setPdfZoom(paperId: string, value: number | null): void {
  if (value === null) zoomByPaper.delete(paperId);
  else zoomByPaper.set(paperId, Math.max(PDF_ZOOM_MIN, Math.min(PDF_ZOOM_MAX, value)));
  // Pan only makes sense when the user has zoomed beyond auto-fit. Reset the
  // tool whenever we drop back to (or below) the live auto-scale — otherwise
  // the toggle unmounts but the user is still in pan mode, which feels broken.
  const z = zoomByPaper.get(paperId);
  const auto = autoScaleByPaper.get(paperId) ?? PDF_ZOOM_BASE;
  if (z === undefined || z <= auto + 0.001) toolByPaper.delete(paperId);
  notify();
}

export function getPdfZoom(paperId: string): number | null {
  return zoomByPaper.get(paperId) ?? null;
}

export function setPdfAutoScale(paperId: string, scale: number): void {
  const prev = autoScaleByPaper.get(paperId);
  if (prev !== undefined && Math.abs(prev - scale) < 0.001) return;
  autoScaleByPaper.set(paperId, scale);
  notify();
}

export function bumpPdfZoom(paperId: string, direction: 1 | -1): void {
  const override = zoomByPaper.get(paperId);
  const auto = autoScaleByPaper.get(paperId) ?? PDF_ZOOM_BASE;
  const current = override ?? auto;
  setPdfZoom(paperId, current + direction * PDF_ZOOM_STEP);
}

export function setPdfTool(paperId: string, tool: PdfTool): void {
  if (tool === "select") toolByPaper.delete(paperId);
  else toolByPaper.set(paperId, tool);
  notify();
}

export function getPdfTool(paperId: string): PdfTool {
  return toolByPaper.get(paperId) ?? "select";
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function usePdfZoom(paperId: string | null): number | null {
  const sub = useCallback(subscribe, []);
  const getSnapshot = useCallback(
    () => (paperId === null ? null : (zoomByPaper.get(paperId) ?? null)),
    [paperId],
  );
  return useSyncExternalStore(sub, getSnapshot, getSnapshot);
}

export function usePdfAutoScale(paperId: string | null): number | null {
  const sub = useCallback(subscribe, []);
  const getSnapshot = useCallback(
    () => (paperId === null ? null : (autoScaleByPaper.get(paperId) ?? null)),
    [paperId],
  );
  return useSyncExternalStore(sub, getSnapshot, getSnapshot);
}

export function usePdfTool(paperId: string | null): PdfTool {
  const sub = useCallback(subscribe, []);
  const getSnapshot = useCallback(
    () => (paperId === null ? "select" : (toolByPaper.get(paperId) ?? "select")),
    [paperId],
  );
  return useSyncExternalStore(sub, getSnapshot, getSnapshot);
}

// Pan only meaningful when there's content beyond auto-fit. Drives the
// visibility of the tool toggle in the header.
export function usePanCapable(paperId: string | null): boolean {
  const zoom = usePdfZoom(paperId);
  const auto = usePdfAutoScale(paperId);
  if (zoom === null) return false;
  return zoom > (auto ?? PDF_ZOOM_BASE) + 0.001;
}
