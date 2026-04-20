# Obelus — codebase conventions

## The product, in one sentence

Writing AI-assisted papers is cheap; reviewing them is the work. Obelus is an offline, browser-only review surface whose output is a file that Claude Code can apply to your paper source.

## Non-negotiable invariants

1. **Offline-first, no runtime network** — zero network calls at runtime. No telemetry, no analytics, no CDN, no Google Fonts.
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

## Commands

- `pnpm dev` — run the web app.
- `pnpm verify` — lint, typecheck, test, network-guard, build.
- `pnpm guard:network` — grep for forbidden network-call strings anywhere in the web or desktop app. Fails CI if any hit.

## When in doubt

Read the plan at the repo root (`docs/plan.md`) or the Obelus design brief. If something in this file conflicts with what you're about to write, update this file — don't quietly diverge.
