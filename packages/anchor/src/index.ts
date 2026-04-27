export {
  type CrossPageEndpoint,
  type EndpointSnapshot,
  findItemIndex,
  normalizeQuote,
  type PageSnapshot,
  pageIndexOf,
  planPage,
  resolveEndpointToAnchor,
  snapshotEndpoint,
} from "./anchor";
export type { Rect } from "./coords";
export { textItemToRect } from "./coords";
export { CONTEXT_WINDOW, extract } from "./extract";
export { imageElementToHtmlAnchor, selectionToHtmlAnchor, verifyHtmlAnchor } from "./html";
export { findImageTarget, quoteForImage } from "./image";
export { rectsFromAnchor } from "./rects";
export { imageElementToSourceAnchor, selectionToSourceAnchor, verifySourceAnchor } from "./source";
export type { Anchor, Bbox } from "./types";
export { snapToWordBounds } from "./word-snap";
