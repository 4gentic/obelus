export { useHtmlDocumentView } from "./adapter";
export type { ClassifyInput, ClassifyResult } from "./classify";
export { classifyHtml } from "./classify";
export type { HtmlMode, HtmlViewHandle, HtmlViewProps } from "./HtmlView";
export { HtmlView } from "./HtmlView";
export type { HtmlMountAnchor } from "./highlights";
export {
  resolveAnchorToRange,
  resolveAnchorToRects,
  resolveHtmlAnchorToRange,
  resolveSourceAnchorToRange,
} from "./highlights";
export type { SanitizeResult } from "./sanitize";
export { sanitizeHtml } from "./sanitize";
export type { HtmlSelectionAnchor, UseHtmlSelectionOptions } from "./use-html-selection";
export { computeHtmlSelectionAnchor, useHtmlSelection } from "./use-html-selection";
