# cmaps/ and standard_fonts/

These two directories are **populated at build time** by the `prebuild` npm
script in `apps/web/package.json`:

```
"prebuild": "cp -R node_modules/pdfjs-dist/cmaps public/ && cp -R node_modules/pdfjs-dist/standard_fonts public/"
```

They are intentionally **not committed** beyond this README. pdfjs-dist ships
them inside its package; we copy them into `public/` so Vite serves them as
static assets at `/cmaps/` and `/standard_fonts/`, which is where `pdfjs.ts`
points `cMapUrl` and `standardFontDataUrl`.

## Why this matters

- `cmaps/` — character-map tables for CJK and other multi-byte encodings. Without
  them, ideographic glyphs render as tofu.
- `standard_fonts/` — the 14 PDF base fonts (Helvetica, Times, Courier, etc.).
  Papers reference these by name rather than embedding them; pdfjs needs the
  data files to substitute them locally.

Running `pnpm build` invokes `prebuild` automatically. If you are hacking on
dev-mode rendering and see boxes instead of text, run the copy manually.
