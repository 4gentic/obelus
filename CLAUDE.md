# Obelus — codebase conventions

## The product, in one sentence

Writing AI-assisted papers is cheap; reviewing them is the work. Obelus is an offline, browser-only review surface whose output is a file that Claude Code can apply to your paper source.

## Non-negotiable invariants

1. **Offline-first, no runtime network** — zero network calls at runtime. No telemetry, no analytics, no CDN, no Google Fonts. *Exception:* the user-triggered `engine_install` flow fetches pinned tarballs from the engines' official GitHub Releases (Typst, Tectonic). No implicit, automatic, or background network activity; no silent updates. The choice is the user's and the download is visible. External resources requested by HTML or Markdown papers (`<img>`, `<source>`, `<link rel=stylesheet>`, `<script src>`) are pre-rewritten to a `data:,` placeholder before they reach the rendered DOM, so the browser never starts the fetch — that's the actual enforcement, not the iframe CSP (CSP via `<meta>` is unreliable in WKWebView/Tauri srcdoc iframes). The user can opt-in per-paper via a "trust this paper" affordance — it appears only when blocked URLs were detected, and persists across sessions in `app-state.json` (desktop) / `localStorage` (web). *Known gap:* an interactive paper's *inline* scripts can still call `fetch` / `XHR` / `WebSocket` if the iframe CSP isn't honoured by the WebView; a future hardening will inject a small shim ahead of author content that overrides those globals and proxies through the parent for trust-gated forwarding.
2. **Paper bytes never leave the device** — PDFs live in OPFS, annotations in IndexedDB via Dexie. `navigator.storage.persist()` is called on first write.
3. **Format-agnostic handoff** — the review bundle is a JSON contract; the Claude Code plugin detects source format (`.tex` / `.md` / `.typ`) at run time.
4. **Pristine, OSS-readable code** — the repo is itself a document. Biome clean, strict TS, no dead flags, no backwards-compat shims.

## Code style

- **Comments**: only when *why* is non-obvious. Never restate what well-named code already says. No "added for X" or "removed because Y" comments — that's git history.
- **TypeScript**: strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. No `any`. No non-null assertions (`!`).
- **Boundaries**: one Zod schema per boundary (`packages/bundle-schema`). No parallel hand-typed duplicates.
- **No feature flags** for code you don't ship. Delete unused code; don't gate it.
- **No error handling for impossible cases** — trust framework guarantees. Only validate at system boundaries (file parsing, network, DOM parsing).
- **Small modules**, named for their role, not their pattern.

## Tracing at ingest boundaries

Every place we turn an external artifact (a plan JSON, a write-up markdown, a bundle the user picked) into internal rows is a boundary. Boundaries must log once, structured, at the end of the operation — even on the happy path. Silent drops are the bug we pay for later.

- **Log before you return.** At every ingest/parse/apply that produces rows, emit one `console.info("[<op>]", { …inputs, …counts, …dropped })`. Counts include `{ blockCount, hunkCount, droppedForX }`; dropped items include their identifiers, not just a count.
- **Never `.filter()` silently.** If you drop rows (unknown id, failed validation, mismatched bundle), accumulate the dropped ids into the return value and log them by name. Zero rows after a filter is a fact the UI deserves to distinguish from "agent produced zero rows".
- **Outcome messages are user-facing.** `jobs-listener.tsx` passes a message into `markDone` / `markError`; make it describe what actually happened — "Plan ready. 3 changes." or "no plan matched session bundle X" — not a generic "done".
- **Errors carry context.** Prefer `throw new Error(\`no plan matched session bundle \${X}; scanned N file(s): …\`)` over bare `throw new Error("not found")`. Anyone reading the status bar should be able to reconstruct the failure.

Search `[ingest-plan]` for the reference shape.

## Aesthetic invariants (Typesetter's charter)

Editorial, literary, paper-like. Warm off-whites, serif type, margin-note layout.

**Refused, on sight:**
- Purple→blue gradients; any multi-stop gradient.
- Sparkle / Wand / Bot / ✨ icons anywhere.
- Glassmorphism, `backdrop-blur` heroes.
- Inter + Geist as the only typefaces.
- "AI-powered" hero copy. You are the reviewer; the AI is the subject under review.
- Animated grid / aurora / star fields.
- Emoji in headers.
- `rounded-2xl` everything — use `2–4px` radii or none.
- Shadcn default card-on-card stacks.
- Dark mode as the marketed default.

**Required:**
- Newsreader (display) + Source Serif 4 (body) + JetBrains Mono (chrome-only), all self-hosted via `@fontsource-variable/*`.
- Paper palette: `#F6F1E7` page · `#EDE5D3` panel · `#2B2A26` ink · `#6B655A` secondary · `#B84A2E` rubric.
- Three-column review layout: PDF · 220px margin gutter · review pane. No modals. Margin notes align vertically to their source line.

## Personas (`.claude/agents/`)

When implementing, delegate to the right persona. Each has a charter with scope and forbidden-patterns guardrails:

- **Typesetter** — CSS, type, layout, UI components.
- **Archivist** — storage, PWA, offline guarantees.
- **Compositor** — PDF rendering and annotation anchoring.
- **Scribe** — bundle schema and the `packages/claude-plugin`.
- **Proofreader** — CI, linting, TS strictness, forbidden-string guard, final audit.
- **Curator** — README, CHANGELOG, CODE_OF_CONDUCT, `.github/` templates, per-package READMEs, collaborator-facing surface.

These personas are for building *Obelus itself*. The `paper-reviewer` subagent shipped in `packages/claude-plugin/agents/` is different — it reviews end-users' papers.

## Repo map

```
apps/web/           Vite + React + TS. Landing at `/`, app at `/app`.
apps/desktop/       Tauri v2 desktop shell wrapping the web app.
packages/
  bundle-schema/    Zod schema + JSON Schema for the review bundle.
  claude-plugin/    The .claude/ plugin distributed to end users.
brand/              SVG marks, favicon, OG image.
.claude/agents/     Project personas (Typesetter / Archivist / Compositor / Scribe / Proofreader / Curator).
packages/claude-plugin/fixtures/sample/
                    Sample paper in .tex / .md / .typ + rendered PDF — used by plugin e2e.
scripts/            guard-network.mjs and other CI helpers.
docs/marketing/     Twitter / LinkedIn / HN copy, all tracked in-repo.
```

## Web/desktop parity

Obelus's web and desktop apps target the same reviewer use cases; the only intentional divergence is that the desktop shell can invoke Claude Code locally and the web cannot. Whenever a feature, ingest flow, or UI affordance is shared between both surfaces, it must be implemented against a shared `packages/*` module consumed by both apps — not cloned into `apps/web/src/` and `apps/desktop/src/`. When adding a new surface, ask: can this be shared? If it can, it must be.

The canonical example is the review surface: PDF and Markdown papers render through adapters (`packages/pdf-view`, `packages/md-view`) that return a shared `DocumentView` contract (`packages/review-shell`). Both apps mount the same highlight overlay, selection capture, and (on web) margin-note stacker — not duplicated code paths. Desktop-only affordances (CodeMirror editor, diff review, ReviewerActionsPanel) stay out of the shared package; the line is "does web have a reason to need this?" — if not, keep it desktop-local.

## Commands

- `pnpm dev` — run the web app.
- `pnpm dev:desktop` — run the Tauri desktop app (compiles Rust first pass).
- `pnpm verify` — lint, typecheck, test, network-guard, build.
- `pnpm guard:network` — grep for forbidden network-call strings anywhere in the web or desktop app. Fails CI if any hit.

## Managed engines

Typst and Tectonic (the LaTeX fallback) can be installed by the app itself into `<app_data>/bin/` via the Wizard's **II.** folio or **Settings → Compile engines**. Resolution order at compile time: managed install → PATH. The install flow lives under `apps/desktop/src-tauri/src/commands/engines/`; pinned versions and per-platform URLs are in `docs/pinned-engines.md`.

## Storage changes need a migration

When the shape of persisted data changes, the running app will not pick it up on its own. Check for this every time you touch:

- `packages/repo/src/types.ts` (row/enum changes)
- `packages/bundle-schema/**` (bundle shape or JSON Schema)
- `apps/desktop/src-tauri/migrations/*.sql` (SQLite schema + `CHECK` constraints)
- `apps/desktop/src-tauri/src/migrations.rs` (the migration registry)
- anything that writes to OPFS or IndexedDB in `apps/web/src/**`.

Two tracks:

1. **SQLite (desktop)** — if you edit or add a `.sql` file, bump it to a new numbered file (`0002_*.sql`, `0003_*.sql`, …) and register it in `src/migrations.rs`. Never edit an already-shipped migration: `CREATE TABLE IF NOT EXISTS` will silently skip existing tables and the new schema will never apply. SQLite does not support dropping a `CHECK` constraint in place — the migration must recreate the table (rename → create new → copy → drop old) or tighten the constraint via `PRAGMA writable_schema` if safe. `RAISE(ABORT, '…')` is only legal inside a trigger body — to abort a migration on a condition, host the `RAISE()` inside a `CREATE TEMP TRIGGER` fired by a throwaway `INSERT` (see `0007_per_paper_scope.sql`). A bare `SELECT RAISE(...)` throws `code 1: RAISE() may only be used within a trigger-program` and blocks boot.
2. **Pre-release resets (OK today)** — until Obelus ships publicly, wiping local state is acceptable. The desktop DB and app state live at `~/Library/Application Support/app.obelus.desktop/` (macOS); delete `obelus.db*` and `app-state.json` to start fresh. Web OPFS/IndexedDB can be cleared via devtools → Application → Storage → Clear site data. Mention this to the user if you made an incompatible change.

**Factory reset is dynamic** — new SQLite tables are covered automatically: `factory_reset` (Rust command in `apps/desktop/src-tauri/src/commands/factory_reset.rs`) discovers tables via `sqlite_master` and wipes every row. Likewise `clearAppState()` wipes every key in `app-state.json`. But if you add a **new kind of store** — a file under `~/Library/Application Support/app.obelus.desktop/` outside the DB, a new Tauri plugin-store path (not `app-state.json`), or (please don't) OPFS/IndexedDB on desktop — you must extend `apps/desktop/src/lib/reset.ts::factoryReset` to clear it, or the next factory reset will leak state.

If you change `ProjectKind`, the bundle schema's `kind` enum, the `annotations` shape, or any persisted row, *both* tracks apply: ship a proper SQLite migration **and** flag the reset for in-flight local state.

## Git hygiene

- **Never `git push` without explicit user confirmation.** A `PreToolUse` hook in `.claude/settings.json` forces a permission prompt on any Bash command containing `git push` (including `--force`, compound commands, flag variants). Don't try to work around it. If a push is warranted, ask first and let the user approve each one.

## When in doubt

Read the plan at the repo root (`docs/plan.md`) or the Obelus design brief. If something in this file conflicts with what you're about to write, update this file — don't quietly diverge.
