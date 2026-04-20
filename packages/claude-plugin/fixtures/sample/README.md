# Sample fixtures

Three source variants of the same short paper on transformer-attention scalability, plus a valid review bundle targeting all three.

## Files

- `sample.tex` — LaTeX source (article class).
- `sample.md` — Markdown with pandoc frontmatter.
- `sample.typ` — Typst source.
- `bundle.json` — a valid bundle with three annotations (one `unclear`, one `citation-needed`, one `praise`).

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

Paste the hex digest into `bundle.pdf.sha256`. The plugin's `apply-marks` skill checks this hash and warns on mismatch.

## How the plugin verifies against these

`pnpm -C packages/claude-plugin verify` loads `bundle.json`, parses it with `@obelus/bundle-schema`, and prints the annotation count. The three source variants let the e2e runner exercise all three format branches of `detect-format` from the same bundle.
