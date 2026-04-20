---
description: Audit the repo for open-source release across code quality, architecture, tech-stack hygiene, and GitHub collaborator readiness. Read-only by default; offers to seed safe defaults for missing files.
argument-hint: "[--fix]  # default is report-only; pass --fix to be offered safe seedings interactively"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent
---

# /oss-audit

One pass. Six personas. A categorized report. Optional seeding of missing boilerplate.

This command is the single way to verify Obelus is ready for open-source release. It orchestrates the existing five personas (`typesetter`, `archivist`, `compositor`, `scribe`, `proofreader`) plus the repo-surface persona (`curator`). Each returns findings in a uniform shape; you consolidate them, present a severity-keyed report, and — if the user passes `--fix` — offer to seed safe defaults one persona-group at a time.

## Execution plan

Follow these steps top-to-bottom. Do not skip step 1.

### 1. Gate: `pnpm verify`

Run `pnpm verify` first. If it fails, stop. Print the last ~40 lines of output and the command that failed. Do not proceed to the audit — a red `verify` is itself the only finding that matters.

If it passes, note it as the first item in the report (`- [verify] pnpm verify — green`) and continue.

### 2. Parallel audit dispatch

Dispatch all six personas in **one** message with six `Agent` tool calls (so they run concurrently). Each agent gets the same output contract:

> Audit your scope for open-source readiness. Report findings as a flat markdown list, one per line, each in the form:
>
> `- [<persona>] <path>:<line> — <finding> → <fix>`
>
> Use `<path>` alone with no colon-number when the finding is a missing file. Group tiny related findings into one line if the fix is identical. Cap response at ~400 words. No prose, no preamble.

Dispatches:

| Agent | Focus |
|---|---|
| `typesetter` | `apps/web/src/**/*.css`, landing + app routes, fonts, palette tokens, refused icons/gradients, emoji in headers, `rounded-2xl`, `backdrop-blur`, glassmorphism. |
| `archivist` | Offline invariants: PWA precache globs, `navigateFallback`, OPFS usage, no runtime `fetch` anywhere, `navigator.storage.persist()` on first write, `guard:network` allow-list integrity. |
| `compositor` | `pdfjs-dist` v4 worker import (`?worker`, not URL constructor), text layer via `pdfjs-dist/web/text_layer_builder`, anchor on `getTextContent().items` stream, no `getBoundingClientRect` for rect math, NFKC normalization on stored quotes. |
| `scribe` | Single Zod source of truth in `packages/bundle-schema`, bundle version literal, plugin skill frontmatter (`name`, `description`, `allowed-tools`, `disable-model-invocation` where writes happen), no `apps/web` imports in `packages/claude-plugin`. |
| `proofreader` | Strict-TS flags present in every per-package `tsconfig.json` (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Biome warnings = 0, no `any` / non-null `!` / `// TODO` / `// FIXME` / `console.log` in `src/`, no backwards-compat comments, no new runtime deps without justification, bundle-size budget. |
| `curator` | `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, `SUPPORT.md`, `.github/CODEOWNERS`, `.github/ISSUE_TEMPLATE/*`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/dependabot.yml`, `.editorconfig`, `.gitattributes`, `.nvmrc`, per-package `README.md`, README badges + sections, CONTRIBUTING persona references. |

### 3. Consolidate

Collect every persona's findings. Classify each into one severity bucket:

- **blocker** — invariant broken (any runtime `fetch`, `any` in a shipped type, gradient in landing, schema duplicated as hand-typed TS). Must fix before the repo is public.
- **recommended** — visible OSS-hygiene gap (`CODE_OF_CONDUCT.md` missing, `.nvmrc` absent, package without `README.md`). Fix before the repo is listed or shared widely.
- **nice-to-have** — polish (CI cache tweak, badge addition, changelog tooling, coverage reporting).

Print the report in this exact shape:

```
## /oss-audit — <YYYY-MM-DD>

### Green
- [verify] pnpm verify — green
- [<persona>] <path>:<line> — <what looks right>

### Blockers
- [<persona>] <path>:<line> — <finding> → <fix>

### Recommended
- ...

### Nice-to-have
- ...
```

If a section is empty, write `_none_` under its heading. Do not omit the heading.

### 4. Offer fixes (only if invoked with `--fix`)

If the user ran `/oss-audit` without `--fix`, stop after step 3.

If `--fix` is present, walk the personas in this order: `curator`, `proofreader`, `scribe`, `archivist`, `compositor`, `typesetter`. For each persona with at least one finding in its autonomous-safe set (see **Fix policy** below), ask exactly once:

> Apply safe seedings/fixes from `<persona>`? Enumerated: <short bullet list>. (y/N)

On `y`, delegate back to the persona via `Agent` with the explicit list of files/edits. On `N` or anything else, skip.

### 5. Residual punch list

After all fix prompts, print a final markdown block titled `## Residual — open for follow-up PR` containing every finding that was not applied (either because the user declined, or because it is not in the autonomous-safe set). Each line is still `- [<persona>] <path>:<line> — <finding> → <fix>`. This is the text to paste into a GitHub issue or `docs/oss-audit-<YYYY-MM-DD>.md`.

## Check catalogue (reference)

The dispatched personas work from their own charters. This catalogue is the *intersection* — the concrete items `/oss-audit` treats as canonical.

### Code quality (proofreader)

- `pnpm verify` green — lint, typecheck, test, `guard:network`, `guard:desktop-only`, build.
- Every per-package `tsconfig.json` extends `../../tsconfig.base.json`. No per-package loosening of strict flags.
- Grep count across `apps/**/src/` + `packages/**/src/` for: ` any[^A-Za-z_]`, `!\.` (non-null), `// ?TODO`, `// ?FIXME`, `console\.log`. Each hit is a finding.
- Grep for comment patterns that restate or historize code: `// removed`, `// added for`, `// was`, `// kept for`. Each hit is a finding.
- No new runtime dep without a written justification in the PR body that produced it (check the last 20 commits touching `package.json`).

### Architecture

- `scripts/guard-network.mjs` passes. No runtime network code anywhere under `apps/**`.
- `scripts/guard-desktop-only.mjs` passes. `apps/web` imports nothing from desktop-only packages.
- No file under `packages/**` imports from `apps/**`. Layering is one-way.
- No cyclic package dependency. A quick check: `pnpm -r exec node -e "console.log(require('./package.json').dependencies||{})"` and inspect.
- One Zod schema per boundary. Grep for hand-typed interfaces that duplicate Zod shapes.

### Tech-specific

- **PWA (archivist)** — `apps/web/vite.config.ts` has `registerType: 'autoUpdate'`, `navigateFallback: '/index.html'`, precache globs include `wasm`, `woff2`, the pdfjs worker chunk, `public/cmaps/`, `public/standard_fonts/`.
- **PDF (compositor)** — worker imported via `?worker` (not `new URL(...)`). Text layer uses `pdfjs-dist/web/text_layer_builder`. Rects computed from transform matrices, not `getBoundingClientRect`.
- **Plugin (scribe)** — every `packages/claude-plugin/skills/*/SKILL.md` has `name`, `description`, `allowed-tools`. Skills that write files set `disable-model-invocation: true`. No imports from `apps/web` anywhere in `packages/claude-plugin`.
- **Aesthetic (typesetter)** — Newsreader + Source Serif 4 self-hosted via `@fontsource-variable/*`. JetBrains Mono used chrome-only. No `Sparkles` / `Wand2` / `Bot` / `Zap` imports from `lucide-react`. No `backdrop-blur`, no multi-stop gradients, no `rounded-2xl`, no `✨ 🚀 🎉` in headers.

### OSS hygiene (curator) — missing-file detection

Each of these, if absent, is a `recommended` finding (not a blocker). Each maps to a template in the fix policy.

- `CODE_OF_CONDUCT.md` — Contributor Covenant 2.1, contact `engineering@4gentic.ai`.
- `CHANGELOG.md` — Keep a Changelog skeleton with an `Unreleased` section.
- `SUPPORT.md` — three-paragraph router: *question → Discussions*, *bug → issue*, *security → email*.
- `.github/CODEOWNERS` — persona-to-path map (see the `curator` charter for the canonical map).
- `.github/ISSUE_TEMPLATE/bug.md`, `feature.md`, `docs.md`, `config.yml` (`blank_issues_enabled: false`).
- `.github/PULL_REQUEST_TEMPLATE.md` — *what* · *why* · *how tested*; two checkboxes.
- `.github/dependabot.yml` — `npm` + `github-actions`, weekly, grouped, limit 5.
- `.editorconfig`, `.gitattributes`, `.nvmrc`.
- `packages/{anchor,bundle-builder,bundle-schema,categories,pdf-view,repo}/README.md` — missing today; `claude-plugin` and `design-tokens` have them.
- Root `README.md` has CI / license / Node badges and the sections `How it works`, `Install`, `Develop`, `Security`, `Contribute`, `License`.

### Collaborator-facing (curator)

- `CONTRIBUTING.md` references `.claude/agents/` so contributors know which charter owns the area they are editing.
- `good-first-mark` label convention documented somewhere (today only in `CONTRIBUTING.md`).
- CI badge in `README.md` links the actual workflow URL.
- No CLA bot, no Codecov requirement, no DCO enforcement in branch-protection settings.

## Fix policy

### Autonomous-safe (can be written on the user's `y`)

File seedings — only if the file is absent. Never overwrite.

- `CODE_OF_CONDUCT.md` — Contributor Covenant 2.1 verbatim, with the contact line set to `engineering@4gentic.ai`.
- `CHANGELOG.md` — header, link to Keep a Changelog + SemVer, and an empty `## [Unreleased]` section.
- `SUPPORT.md` — three paragraphs, literary voice.
- `.github/CODEOWNERS` — the map from the `curator` charter, `* @<repo-owner-here>` as the catch-all (leave the handle literal for the maintainer to fill).
- `.github/ISSUE_TEMPLATE/bug.md` — short: *what you did*, *what you expected*, *what happened*, *environment (browser / OS / Obelus version)*. No emoji, no ASCII art.
- `.github/ISSUE_TEMPLATE/feature.md` — *what you want*, *why*, *what would be enough for v1*.
- `.github/ISSUE_TEMPLATE/docs.md` — *which doc*, *what is wrong or missing*.
- `.github/ISSUE_TEMPLATE/config.yml` — `blank_issues_enabled: false`, contact_links for Discussions + security.
- `.github/PULL_REQUEST_TEMPLATE.md` — the three sections + two checkboxes.
- `.github/dependabot.yml` — npm (root + `apps/web`, `apps/desktop`, `packages/*`) + github-actions, weekly, grouped, limit 5.
- `.editorconfig` — settings from the `curator` charter.
- `.gitattributes` — `* text=auto eol=lf` + binary globs.
- `.nvmrc` — the major.minor.patch currently in `engines.node`.
- `packages/<name>/README.md` stubs — four paragraphs: *What*, *Why*, *Boundary*, *Public API*. The `Public API` paragraph is filled from `packages/<name>/src/index.ts` exports by reading the file.
- README badge row — add only missing badges (CI, MIT, Node engine). Do not touch existing prose.

### Not autonomous

Route these back to the owning persona, emit as punch-list items, but do not edit:

- Rewrites of existing prose in `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CLAUDE.md`.
- Schema changes, `package.json` dependency additions, CI workflow edits beyond trivial additions (e.g. a new badge-fed job).
- Anything flagged inside `typesetter` / `compositor` / `scribe` / `archivist` scope — those go back to the owning persona as a follow-up.

## Voice reminders (applies to every seeded file)

- Declarative. Periods. No exclamations.
- No emoji anywhere in seeded files.
- No "powerful", "seamless", "leverages", "cutting-edge", "AI-powered".
- Short is better than long. A CoC is ~100 lines; a PR template is ~15 lines.

## Why this command exists

The repo is itself a document. `/oss-audit` is the last reader before it becomes public — the one who checks that every surface a first-time contributor sees is deliberate, consistent, and deserving of the sixty seconds of attention it will get.
