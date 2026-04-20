# @obelus/design-tokens

**What.** The paper palette, highlight colours, font stacks, and frame metrics, exported as both TypeScript constants and a CSS custom-properties stylesheet.

**Why.** The aesthetic invariants — warm off-whites, serif type, category-coded highlights — live in one module so that every surface (web, desktop, plugin scaffolds) reaches for the same tokens. Drift into generic SaaS colour is caught by the typesetter charter and by the limited surface this file exposes.

**Boundary.** This package exports values. It does not style components, load fonts, or decide where the tokens are applied. Font files themselves are shipped via `@fontsource-variable/*` in the apps that render text.

**Public API.**
- `palette` — paper, panel, ink, ink-soft, rubric.
- `highlight` — the six category colours (unclear, wrong, weak, cite, praise, rephrase).
- `fonts` — display, body, mono stacks.
- `frame` — chrome metrics (e.g. `headerHeight`).
- Types: `PaletteToken`, `HighlightToken`.
- CSS entry: `src/tokens.css` — the same values as custom properties.
