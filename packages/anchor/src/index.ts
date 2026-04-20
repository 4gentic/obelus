export {
  type CrossPageEndpoint,
  type EndpointSnapshot,
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
export { selectionToHtmlAnchor, verifyHtmlAnchor } from "./html";
export { rectsFromAnchor } from "./rects";
export { selectionToSourceAnchor, verifySourceAnchor } from "./source";
export type { Anchor, Bbox } from "./types";
