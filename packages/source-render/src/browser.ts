// Browser-safe entry point.
//
// The rest of `@obelus/source-render` pulls in Node-only code for the LaTeX
// and Typst renderers (child_process, fs). This subpath re-exports only the
// bits that are pure JS and safe inside apps/web's PWA bundle: the markdown
// renderer and its result/error types.
//
// `scripts/guard-desktop-only.mjs` explicitly whitelists this subpath; a bare
// `@obelus/source-render` import from apps/web is still refused.

export type { AssetResolver } from "./asset-rewrite.js";
export { rewriteRelativeAssets } from "./asset-rewrite.js";
export { renderMarkdown } from "./markdown.js";
export type { RenderError, RenderResult, SourceMap, SourceMapBlock } from "./types.js";
