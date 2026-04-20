# @obelus/web

**What.** The Obelus web app — Vite + React + TypeScript PWA. Landing at `/`, review surface at `/app`. Installable; fully functional offline after first load.

**Why.** Writing AI-assisted papers is cheap; reviewing them is the work. This is the reviewer's surface — a PDF, margin notes, threaded annotations, rubric categories — running entirely on-device. The output is a JSON review bundle the Claude Code plugin applies to the paper source.

**Boundary.** Zero runtime network, enforced by `scripts/guard-network.mjs`. No telemetry, no analytics, no CDN, no Google Fonts. PDFs live in OPFS; annotations in IndexedDB via Dexie. `navigator.storage.persist()` is requested on first write. The service worker precaches everything needed to run offline (pdfjs worker + cmaps + fonts).

**Public surface.**

- `/` — landing page.
- `/app` — library + review route.
- Bundle export (`.json`) is the only artifact that leaves the device.
- Deployed to [obelus.4gentic.ai](https://obelus.4gentic.ai) via `.github/workflows/pages.yml`.

**Develop.**

```sh
pnpm dev              # Vite dev server on :5173
pnpm -C apps/web e2e  # Playwright
```
