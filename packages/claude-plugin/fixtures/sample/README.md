# Sample fixtures

Three source variants of the same short paper on transformer-attention scalability, plus a valid review bundle targeting all three.

## Files

- `sample.tex` — LaTeX source (article class).
- `sample.md` — Markdown with pandoc frontmatter.
- `sample.typ` — Typst source.
- `sample.html` — paired-source HTML rendered from `sample.md` via `@obelus/source-render`. Carries `data-html-file` on `<body>` and `data-src-file`/`data-src-line` on every leaf block so HTML anchors round-trip back into `sample.md`. Regenerate with `_render-html.mjs` (see below).
- `sample-handauthored.html` — a small hand-authored HTML manuscript with no `data-src-*` attributes; the only paired hint is `data-html-file` on `<body>`. Used by the hand-authored HTML e2e scenario where the planner cannot resolve a source line range.
- `bundle.json` — a valid bundle with three annotations (one `unclear`, one `citation-needed`, one `praise`) anchored to the rendered PDF.
- `bundle-md.json` — a valid bundle with two `source`-anchored annotations pointing at specific lines of `sample.md`; used by the plugin-e2e `revise-markdown-source` scenario to prove the markdown round-trip.
- `bundle-html-paired.json` — a valid bundle whose two annotations carry `kind: "html"` anchors against `sample.html`, each with a `sourceHint` `SourceAnchor` pointing back into `sample.md`. The paper's `entrypoint` is `sample.md` — paired bundles target the source.
- `bundle-html-handauthored.json` — a valid bundle whose two annotations carry `kind: "html"` anchors against `sample-handauthored.html` with no `sourceHint`. The planner emits `ambiguous: true` blocks per the `plan-fix` HTML branch.

The `.pdf` is deliberately not committed: binaries in a source repo age poorly and this fixture is meant to be regenerated on demand.

## Regenerating the PDF

Pick any one of the three sources. Any of these recipes produces a byte-identical-ish PDF suitable for the fixture:

```sh
# LaTeX
latexmk -pdf sample.tex

# Markdown (via pandoc + a LaTeX engine)
pandoc sample.md -o sample.pdf --pdf-engine=xelatex

# Typst
typst compile sample.typ sample.pdf
```

After rendering, recompute the SHA-256 and update `bundle.json`:

```sh
shasum -a 256 sample.pdf
```

Paste the hex digest into `bundle.pdf.sha256`. The plugin's `apply-revision` skill checks this hash and warns on mismatch.

## Regenerating `sample.html`

`sample.html` is produced from `sample.md` by feeding it through `@obelus/source-render`'s `renderMarkdown`. The helper is checked in:

```sh
( cd packages/source-render && pnpm exec tsx /abs/path/to/packages/claude-plugin/fixtures/sample/_render-html.mjs )
```

The helper emits a `<body data-html-file="sample.html">` shell wrapping `<article data-src-file="sample.md">`, then the rendered hast tree (every leaf block carrying `data-src-line` etc.). Re-run after editing `sample.md`.

## How the plugin verifies against these

`pnpm -C packages/claude-plugin verify` loads `bundle.json`, parses it with `@obelus/bundle-schema`, and prints the annotation count. The three source variants let the e2e runner exercise all three format branches of `apply-revision` from the same bundle.
