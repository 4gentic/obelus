# Obelus brand

All assets are MIT-licensed alongside the code.

## The mark

`÷` — the obelus. A horizontal rule with a dot above and below. In medieval manuscripts scribes drew it in the margin next to passages they judged doubtful or spurious. That is what Obelus is for.

## Files

| File | Use |
|---|---|
| `mark.svg` | Primary — rubric red `#B84A2E`, transparent background. |
| `mark-ink.svg` | Ink `#2B2A26` — for favicons, dark surfaces, and sizes below 24×24. |
| `lockup.svg` | Mark + wordmark. Wordmark is Newsreader italic. Intended for app header and landing hero. **Before shipping, convert the `<text>` to outlines** so the SVG renders identically without the webfont. |
| `favicon.svg` | Mark on `#F6F1E7` paper background, 64×64. |

## Palette

| Token | Hex | Role |
|---|---|---|
| paper | `#F6F1E7` | background |
| panel | `#EDE5D3` | sidebars, margin gutter |
| ink | `#2B2A26` | primary type |
| ink-soft | `#6B655A` | secondary type, metadata |
| rubric | `#B84A2E` | the mark, drop caps, errors |

## Clearspace

Leave at least `2×` the dot radius of clearspace around the mark. Don't place it inside bordered boxes.

## Minimum size

- `mark.svg` — 24×24.
- `mark-ink.svg` — 16×16.

## Don't

- Don't tint the mark with a gradient.
- Don't rotate it.
- Don't pair it with a sparkle, bolt, or "AI" glyph.
- Don't place it on saturated backgrounds — only on `paper`, `panel`, `ink`, or white.
