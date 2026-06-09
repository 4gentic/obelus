import type { PageViewport, PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

// Minimal TextItem stub. All items sit at the origin with width = string
// length; that is enough to exercise the index/search/re-anchor logic, which
// keys off text content and item indices rather than precise geometry.
export function ti(str: string, eol = false): TextItem {
  return {
    str,
    dir: "ltr",
    width: str.length,
    height: 1,
    transform: [1, 0, 0, 1, 0, 0],
    fontName: "mock",
    hasEOL: eol,
  };
}

export type MockPage = {
  items: TextItem[];
  viewport: PageViewport;
};

export function mockViewport(): PageViewport {
  const vp = {
    convertToViewportRectangle: (rect: readonly [number, number, number, number]) =>
      [rect[0], rect[1], rect[2], rect[3]] as [number, number, number, number],
  };
  return vp as unknown as PageViewport;
}

export function mockDoc(pages: MockPage[]): PDFDocumentProxy {
  const doc = {
    numPages: pages.length,
    getPage: (n: number): Promise<PDFPageProxy> => {
      const page = pages[n - 1];
      if (!page) return Promise.reject(new Error(`page ${n} missing`));
      const proxy = {
        getTextContent: () => Promise.resolve({ items: page.items, styles: {}, lang: null }),
        getViewport: () => page.viewport,
        cleanup: () => {},
      };
      return Promise.resolve(proxy as unknown as PDFPageProxy);
    },
  };
  return doc as unknown as PDFDocumentProxy;
}
