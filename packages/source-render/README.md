# @obelus/source-render

**What.** Desktop-only rendering of a paper's source (`.tex`, `.md`, `.typ`) into a PDF plus a source map from source spans to rendered locations.

**Why.** The desktop build wants to show the source alongside the rendered page so that a reviewer can anchor into either. Rendering is delegated to external binaries (`pdflatex`, `typst`); this package is the thin wrapper that detects binaries, shells out, and returns a structured result or a typed failure.

**Boundary.** Node-side only. Never imported from `apps/web`. It does not persist, does not render React, and does not decide when to re-render — callers drive the rebuild cadence.

**Public API.**
- `renderLatex`, `renderMarkdown`, `renderTypst` — format-specific render entry points.
- `detectLatexBinary`, `LATEX_BINARIES` — probe the host for a usable LaTeX engine.
- `nodeSpawner` — default `Spawner` implementation over `child_process`.
- `RenderFailedPane` — React surface for rendering errors.
- Types: `LatexBinary`, `LatexDetection`, `Spawner`, `SpawnOptions`, `SpawnResult`, `RenderError`, `RenderResult`, `SourceMap`, `SourceMapBlock`.
