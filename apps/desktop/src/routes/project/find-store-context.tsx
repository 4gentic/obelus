import type { JSX } from "react";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef } from "react";
import { createFindStore, type FindStore } from "../../lib/find-store";
import {
  createPdfFindProvider,
  createPdfFindRectsStore,
  type PdfFindRectsStore,
} from "../../lib/pdf-find-provider";
import { useProject } from "./context";
import { useOpenPaper } from "./OpenPaper";

interface Bundle {
  store: FindStore;
  pdfRects: PdfFindRectsStore;
}

const FindStoreContext = createContext<Bundle | null>(null);

// Provider is paper-scoped: query/case-sensitivity reset on every paper swap
// so a stale search from one paper doesn't leak into another. Within a paper,
// the format-specific provider (PDF / MD / HTML) is registered through
// `setProvider` by whichever surface is currently mounted.
export function FindStoreProvider({ children }: { children: ReactNode }): JSX.Element {
  const bundle = useMemo<Bundle>(
    () => ({ store: createFindStore(), pdfRects: createPdfFindRectsStore() }),
    [],
  );
  const openPaper = useOpenPaper();
  const { openFilePath } = useProject();
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    // Reset on every cross-paper swap so a query carried from paper A doesn't
    // leak into paper B. Stays put while the user toggles preview ↔ source on
    // the same path (the path is unchanged across the toggle).
    if (lastPath.current !== null && lastPath.current !== openFilePath) {
      bundle.store.getState().resetForPaperSwap();
    }
    lastPath.current = openFilePath;
  }, [openFilePath, bundle]);

  // PDF papers register a wrapped pdfjs-backed provider; other formats
  // (MD/HTML) self-register from their own surfaces via `setProvider`.
  useEffect(() => {
    if (openPaper.kind !== "ready") return;
    const provider = createPdfFindProvider(openPaper.doc, bundle.pdfRects);
    bundle.store.getState().setProvider(provider);
    return () => {
      bundle.store.getState().setProvider(null);
    };
  }, [openPaper, bundle]);

  return <FindStoreContext.Provider value={bundle}>{children}</FindStoreContext.Provider>;
}

export function useFindStore(): FindStore {
  const bundle = useContext(FindStoreContext);
  if (!bundle) throw new Error("useFindStore requires FindStoreProvider");
  return bundle.store;
}

export function usePdfFindRectsStore(): PdfFindRectsStore {
  const bundle = useContext(FindStoreContext);
  if (!bundle) throw new Error("usePdfFindRectsStore requires FindStoreProvider");
  return bundle.pdfRects;
}
