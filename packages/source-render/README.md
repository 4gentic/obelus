# @obelus/source-render

**What.** Desktop-only rendering of a paper's source (`.tex`, `.md`, `.typ`) into a PDF plus a source map from source spans to rendered locations.

**Why.** The desktop build wants to show the source alongside the rendered page so that a reviewer can anchor into either. Rendering is delegated to external binaries (`pdflatex`, `typst`); this package is the thin wrapper that detects binaries, shells out, and returns a structured result or a typed failure.

**Boundary.** The root export (`@obelus/source-render`) is Node-side only: the LaTeX and Typst renderers shell out via `child_process`, and `nodeSpawner` / `RenderFailedPane` bring in React + Node. `apps/web` must not import from the root.

A narrow `@obelus/source-render/browser` subpath is allowed from `apps/web` for markdown-only review. It re-exports `renderMarkdown` (pure JS — `mdast-util-*` + `hast-util-to-html` + `micromark-extension-gfm`) and its result/error types. `scripts/guard-desktop-only.mjs` enforces this split.

**Public API.**
- Root (`@obelus/source-render`) — `renderLatex`, `renderMarkdown`, `renderTypst`, `detectLatexBinary`, `LATEX_BINARIES`, `nodeSpawner`, `RenderFailedPane`, and all types.
- Browser subpath (`@obelus/source-render/browser`) — `renderMarkdown`, `RenderError`, `RenderResult`, `SourceMap`, `SourceMapBlock`.
