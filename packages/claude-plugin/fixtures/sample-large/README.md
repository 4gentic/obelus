# Large sample fixture

A full-length survey paper — *The Scalability of Transformer Attention: A Critical
Survey of Long-Context Mechanisms* — in three source variants kept in sync, plus a
shared bibliography and two review bundles. It is the large counterpart to the short
fixture in `../sample/`: same domain, same author, deepened into a sixteen-section
treatment with a real multi-entry reference list.

Its purpose is to exercise the scalability path that the short fixture cannot: each
source variant is ~27–30 KB, large enough that the full inline body comfortably
exceeds a small context budget, so section-map / scoped navigation can be validated
against full-inline ingestion on a paper that actually has many sections to map.

## Files

- `sample.tex` — LaTeX source (article class) with `\tableofcontents`, an `amsmath`
  display, a `booktabs` complexity table, and an inline `thebibliography`.
- `sample.md` — pandoc-frontmatter Markdown of the same paper. Headings are `##`,
  the complexity table is a GFM table, and citations are pandoc `[@key]` keys
  resolved against `references.bib`. The reference section is left as a `## References`
  stub for pandoc/citeproc to fill.
- `sample.typ` — Typst source with `#outline()`, a `#figure`/`table`, math, and a
  native `#bibliography("references.bib")`.
- `references.bib` — eleven BibLaTeX entries shared by the Typst (`#bibliography`)
  and Markdown (pandoc `bibliography:`) variants, and mirrored inline by the LaTeX
  `thebibliography`. Edit all four citation surfaces together.
- `bundle.json` — a `writer` bundle with three annotations (one `elaborate` on a PDF
  anchor, one `wrong` on a `sample.tex` source anchor, one `praise` on an HTML anchor
  carrying a `sourceHint` back into `sample.tex`). The PDF entrypoint is `sample.tex`.
- `bundle-md.json` — a `reviewer` bundle whose two `source`-anchored annotations point
  at specific lines/columns of `sample.md` (line 16, the unsupported "most deployed
  pipelines" claim; line 80, the under-attributed equivalence claim).

There is no HTML variant here; the paired/hand-authored HTML round-trips are covered
by `../sample/`. This fixture targets long-form, multi-section navigation, so it keeps
to the three core source formats plus the bibliography.

The `.pdf` is deliberately not committed — binaries age poorly in a source tree and
the fixture is meant to be rendered on demand (the bundle carries a placeholder
`sha256`).

## Regenerating the PDF

Pick any one of the three sources:

```sh
# Typst (renders references.bib natively)
typst compile sample.typ sample.pdf

# LaTeX
latexmk -pdf sample.tex

# Markdown (via pandoc + a LaTeX engine, resolving citations)
pandoc sample.md --citeproc -o sample.pdf --pdf-engine=xelatex
```

The Typst source renders to a nine-page PDF. After rendering, recompute the SHA-256
and paste it into `bundle.json` → `papers[0].pdf.sha256`:

```sh
shasum -a 256 sample.pdf
```

The plugin's `apply-revision` skill checks this hash and warns on mismatch.

## Keeping the three formats in sync

The `.tex`, `.md`, and `.typ` are faithful renderings of the *same* paper — same
section order, same prose, same claims, same citations. When you edit one, edit all
three (and `references.bib` if a citation changes), or the cross-format e2e branches
will diverge. The anchors in `bundle-md.json` are pinned to exact line/column offsets
in `sample.md`; re-run the offset check below after any edit to that file.

```sh
node -e 'const fs=require("fs");const md=fs.readFileSync("sample.md","utf8").split("\n");
for(const [ln,q] of [[16,"most deployed pipelines still truncate"],[80,"It is sometimes claimed that linear attention"]]){
  const i=md[ln-1].indexOf(q);console.log(`line ${ln}: ${i<0?"MISSING":"colStart="+i}`);}'
```
