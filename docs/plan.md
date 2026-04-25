# Obelus — Desktop expansion (PWA + Tauri v2)

## Context

Obelus today is a browser-only offline PWA for reviewing academic PDFs: highlight, margin-note,
export a JSON bundle, hand the bundle to `packages/claude-plugin`, let Claude Code apply edits to
`.tex/.md/.typ` source in a separate step. The review surface is sharp; the handoff is clumsy.

This plan adds a **Tauri v2 desktop app** that closes the loop: detects the user's installed
`claude` CLI, ingests either a source folder (writer) or a PDF / folder of PDFs (reviewer),
renders source to HTML for highlight-on-preview, and shows Claude's edits as a git-style
diff you can accept, reject, edit, or comment on — one hunk at a time, or all at once.

The PWA stays. Same URL, same PDF-only review flow, same bundle export. It is the no-install
on-ramp and the demo surface. The desktop app is where the work actually lands in the paper.

### Why this shape (decisions already made with the user)

- **Ship both.** PWA at obelus.app stays on v1 (PDF review + v1 bundle export). Desktop is the
  pro surface and gets every new capability (source folders, HTML, multi-project, diff review).
- **Tauri v2** (Rust core + webview). Not Electron. Matches the "pristine OSS, no bloat" bar.
- **Claude via user's installed `claude` CLI.** Wizard detects, prompts install if missing,
  reuses whatever auth the user already has. We own zero credentials.
- **HTML selection** covers (a) rendered preview of the user's own source and (b) any `.html`
  file inside a project folder — both can receive suggestions.

## The product in two surfaces

```
┌────────────────────────────────────────────────────────────────────┐
│  obelus.app  (PWA, stays)                                          │
│    PDF review · margin notes · bundle v1 export → your clipboard  │
│    Pitch: "no install, drop a PDF, try the surface."               │
│                                                                    │
│  Obelus Desktop  (Tauri v2, new)                                   │
│    Projects · file tree · PDF + HTML + source preview selection   │
│    Claude CLI sidecar · git-style diff review · write-up drafts   │
│    Pitch: "from marks to applied edits, without leaving the app."  │
└────────────────────────────────────────────────────────────────────┘
```

Feature-drift guard: every new feature lives in a **shared package** with a capability
descriptor. The PWA build simply lacks desktop capabilities (claude-sidecar, fs walking,
source rendering, SQLite repo) — the same React tree renders a "Open in Obelus Desktop"
empty state instead. No forked UI.

## Personas & project types

| Persona | Input | Output | Desktop screen |
|---|---|---|---|
| **Writer** | source folder (any depth, mixed .tex/.md/.typ/.pdf/.html) | edits applied to source | file tree + source/HTML split + diff review |
| **Reviewer** | single PDF | markdown review write-up | today's 3-col review + "Draft the write-up" |
| **Stack reviewer** | folder of PDFs (any depth) | one write-up per PDF, or consolidated packet | PDF list sidebar + today's 3-col review |

A project is `{ kind: 'folder' | 'single-pdf', root, label }`. All three personas are flavours
of these two kinds.

## Architecture

### Monorepo layout (target)

```
apps/
  web/                    existing PWA — thin shell, frozen at v1 bundle export
  desktop/                NEW — Tauri v2 app (Rust + Vite React renderer)
    src-tauri/            Rust core, plugins, commands
    src/                  React renderer (separate Vite entry, shares packages)
packages/
  bundle-schema/          Zod + JSON Schema — bumped to v2 (see below), v1 kept for compat
  claude-plugin/          existing 4 skills + paper-reviewer subagent
                          + NEW: apply-review-v2 skill, plan-fix emits .obelus/plan-<ts>.json
  anchor/                 NEW — pure TS, extracted from apps/web/src/annotations/
    pdf.ts · source.ts · html.ts · extract.ts · rects.ts
  pdf-view/               NEW — PdfDocument + PdfPage + SelectionListener (from apps/web/src/pdf/)
  source-render/          NEW — desktop-only; latex (tectonic+tex4ht), typst, markdown (remark)
                          emits HTML with data-src-file / data-src-line / data-src-col attributes
  repo/                   NEW — Repository interface + dexie impl (web) + sqlite impl (desktop)
  bundle-builder/         NEW — takes Repository + ids → BundleV2 (pure)
  categories/             NEW — default 6 + per-project override schema
  design-tokens/          NEW — tokens.css + TS constants
  claude-sidecar/         NEW — desktop-only; Rust spawn + TS streaming event contract
```

Ordering: move shared logic first (anchor, pdf-view, repo interface, bundle-schema v2, tokens),
keep PWA green at every step. Only then add `apps/desktop` and desktop-only packages.

### Tauri shell

- **Plugins (minimal):** `dialog`, `fs` (runtime-scoped to picked roots only), `shell` (for
  `claude`), `sql` (SQLite), `store` (tiny KV for wizard + window state), `process`, `updater`,
  `fs-watcher` (notify crate). **No stronghold** — we own no credentials.
- **FS scoping** via Rust commands: all fs ops re-check path is a descendant of an allowed
  project root. Belt-and-braces over Tauri v2's capability allowlist.
- **Persistence split:** `app-state.json` via `plugin-store` (window geometry, wizard state,
  claude-detect cache); `obelus.db` SQLite for projects / papers / revisions / annotations /
  review-sessions / diff-hunks / project-categories.
- **Renderer:** `apps/desktop/src` is its own Vite entry; shares React components via packages.
  Rejecting a single dual-build entry because desktop has routes (wizard, project shell, diff)
  the PWA doesn't, and vice versa.

### Claude CLI sidecar (the Aperant-style wizard hook)

Detection order: `$PATH` → `OBELUS_CLAUDE_BIN` env → `~/.local/bin/claude` → `~/.claude/bin` →
npm global bin → `npx --no-install @anthropic-ai/claude-code` probe → fail. Version floor
checked with `claude --version`; below floor → wizard asks for upgrade.

Invocation: **non-interactive, bundled plugin, no contamination of user's `~/.claude`**.

```
claude --print \
  --plugin-dir   <app-resources>/plugin/<app-version>/ \
  --add-dir      <project-root> \
  --allowedTools "Read Glob Grep" \
  --prompt-file  <tmp-prompt.md>     // "Run apply-review-v2 with bundle path X"
```

Streaming: Tauri `Command::spawn()` → Rust task reads stdout/stderr lines → emits `claude:stdout`
/ `claude:stderr` events with `{ sessionId, line, ts }`. UI subscribes. Cancel: keep `Child`
handles in a `DashMap<SessionId, Child>`, `child.kill()` on user abort.

### Bundle schema v2

Additive where possible, breaks single-paper assumption cleanly. Existing v1 plugin path stays;
plugin reads `bundleVersion` and dispatches.

```ts
const PdfAnchor    = z.object({ kind: z.literal("pdf"),    page, bbox, textItemRange });
const SourceAnchor = z.object({ kind: z.literal("source"),
                                file, lineStart, colStart, lineEnd, colEnd });
const HtmlAnchor   = z.object({ kind: z.literal("html"),
                                file, xpath, charOffsetStart, charOffsetEnd,
                                sourceHint: SourceAnchor.optional() });

BundleV2 = {
  bundleVersion: "2.0",
  tool: { name: "obelus", version },
  project: { id, label, kind, categories: [{ slug, label, color? }] },
  papers:  [{ id, title, revision, createdAt, pdf?: {relPath, sha256, pageCount}, entrypoint? }],
  annotations: [{ id, paperId, category /* free string */, quote, contextBefore, contextAfter,
                  anchor: discriminated(PdfAnchor | SourceAnchor | HtmlAnchor),
                  note, thread, createdAt, groupId? }],
};
```

PWA keeps exporting v1. Desktop exports v2. Plugin supports both via a dispatch in
`packages/claude-plugin/skills/apply-review/SKILL.md`. `CategoryV1` enum kept as
`CategoryV1Legacy`.

### Diff-review engine

- **Plugin emits a machine-readable companion** `.obelus/plan-<ts>.json` alongside the
  existing `plan-<ts>.md`. Shape:

  ```json
  { "bundleId":"…", "blocks": [
    { "annotationId":"…", "file":"main.tex", "category":"unclear",
      "patch":"@@ -42,3 +42,3 @@\n- old\n+ new\n",
      "ambiguous": false, "reviewerNotes":"…" } ] }
  ```
  We refuse to re-parse `plan.md` prose — we own both ends, contract is JSON.

- **Per-hunk state** in SQLite `diff_hunks`: `pending | accepted | rejected | modified`.
  `modified_patch_text` stores user-edited text.

- **Apply semantics:**
  - "Apply all accepted" = atomic: patch each accepted hunk to a tempfile, fsync, rename,
    only promote after every file succeeds. Backup originals to `.obelus/backup/<session-id>/`.
  - "Apply one-by-one" = accept single hunk → apply immediately; later hunks rebase via fuzzy
    application, annotation gets re-located if fuzz fails.
  - Optional git integration if `.git` exists: "commit per category" or "one commit" toggle.
    Shell out to `git` (no libgit2), scoped to project root. **Off by default for v1.**

### HTML source preview (writer mode)

Recommend **Tectonic + tex4ht for LaTeX**, **Pandoc as fallback**, **typst-native HTML behind
an experimental flag**, **remark for Markdown**. Self-contained sidecar binaries, ~80 MB LaTeX
cost is the most expensive line-item; surfaced as an open decision below.

All renderers emit `data-src-file` / `data-src-line` / `data-src-col` on block-level elements.
Selection in the rendered HTML walks up to the nearest such element, then derives character
offsets within the source line. Precision: line-exact for all three; column-exact for Markdown,
approximate-then-refined-by-substring for LaTeX, line-only for Typst v1.

Verification: every `SourceAnchor` round-trips through a post-capture check that reads the
file and asserts the char range contains the quote. On mismatch → fall back to v1 fuzzy anchor
and flag `sourceMapUnverified: true`.

### Storage

Shared `Repository` interface in `packages/repo`. Sub-repos: `projects`, `papers`, `revisions`,
`annotations`, `reviewSessions`, `diffHunks`, `settings`, plus `transaction<T>(fn)`.

- **Dexie impl** (web): moved from `apps/web/src/storage/`, throws `NotSupportedError` for
  project / reviewSession / diffHunk sub-repos. UI gates via `repo.supports('projects')`.
- **SQLite impl** (desktop): `packages/repo/src/sqlite/`, Tauri `plugin-sql`. Forward-only
  numbered migrations via `include_str!`. Pre-migration backup to `obelus.db.bak-<version>`.

## UX (decisions)

### Wizard (one screen, folios turn like book pages, no progress bar)

**Folio 1 — Claude binary.** Passive detection. Copy:

> First, the machinist.
>
> Obelus does not speak to any model. It asks Claude Code, already on your disk, to do the work.
>
> ```
> claude  —  found   v1.0.42
> auth    —  ready   signed in
> ```

Missing binary → shows `brew install …` and `npm i -g @anthropic-ai/claude-code` with
copy-to-clipboard; "I will check again when you come back."

**Folio 2 — Name the desk.** Skippable, shown once on first run.

**Folio 3 — First project.** Two cards, no icons, 1px ink rule:

```
┌─────────────────┐  ┌─────────────────┐
│ A paper I'm     │  │ A paper I'm     │
│ writing.        │  │ reviewing.      │
│ Pick folder →   │  │ Pick file(s) →  │
└─────────────────┘  └─────────────────┘
```

Writer post-pick → one more folio: `Render the source now? [yes] [later]`.
Reviewer post-pick → straight to project view.
Finish line: "The desk is set. Open when ready." No confetti.

### Home / project switcher (launch landing)

Reuses `apps/web/src/routes/library.tsx` row pattern. Sections: **Pinned** (cmd-shift-p),
**Recent** (ordered by last-opened), **Archive**. Rename inline, cmd-k fuzzy palette scoped to
projects + files (not hunks — hunk nav is j/k). No left sidebar in the app chrome.
Missing-folder state: project title stricken through, inline `[repoint] [forget]` — we never
guess a new path.

### Project view — writer mode

```
┌──────────┬────────────────────────────┬─────────┬──────────────┐
│ FILES    │ SOURCE          RENDERED   │ MARGIN  │ REVIEW        │
│ intro.tex│ \section{Intro} 1 Intro    │ ¶ line14│ cat + note +  │
│ method.md│ We claim…       We claim…  │ unclear │ Start review⟶│
│ refs.bib │                            │         │               │
│ fig1.pdf │ (swaps on .pdf / .html)    │         │               │
└──────────┴────────────────────────────┴─────────┴──────────────┘
  ~200px          center split               220px         340px
```

Three-column DNA preserved. Leftmost FILES is an added gutter, not a replacement.
Center is a split for source; full-width PDF for `.pdf`; HTML-only for `.html`.
`Start review ⟶` default = project-wide; alt-click = this file only.

### Reviewer mode

Single PDF: identical to today's `/app/review/:paperId`, footer button is "Draft the write-up".
Stack reviewer (folder): left list of PDFs with checkmark on completed; export options are
"one doc per paper" (default) or "consolidated packet".

### Diff review (the centerpiece)

Replaces the review-pane column when a Claude run completes. File tree + source stay.

```
│ REVIEW — DIFF                               │
│ intro.tex(2) · method.md(1) · refs.bib(1)   │
│ 4/12 accepted                apply · .      │
│                                             │
│ intro.tex · hunk 1/4                        │
│ prompted by mark 7 · line 14 · unclear      │
│                                             │
│ ── old ──────────                           │
│ We claim that Z is always Y.                │
│                                             │
│ ── new ──────────                           │
│ We claim that the covariance matrix Z is    │
│ PSD…                                        │
│                                             │
│ [ accept · a ]  [ reject · r ]              │
│ [ edit   · e ]  [ note   · n ]              │
│                                             │
│ j/k next·prev   ·apply-all   ⌫ discard     │
│ ↻ request re-review   ⇧a accept all in file│
```

**Colors from the paper palette — no green/red.** Derived tokens:

```css
--diff-old-bg   : color-mix(in oklab, var(--rubric) 12%, var(--paper));
--diff-old-rule : var(--rubric);            /* existing #B84A2E */
--diff-new-bg   : color-mix(in oklab, var(--hl-cite) 14%, var(--paper));
--diff-new-rule : var(--hl-cite);           /* existing sage */
```

Keystrokes (Prince-of-Persia economy, no chord > 2 keys):
`j/k` nav · `a/r` accept/reject · `e` edit inline · `n` note for next pass · `.` apply all ·
`,` request re-review · `⌫` discard · `⇧a` accept file · `gg`/`G` top/bottom.

**Comment-for-next-pass** captures a text note attached to a hunk; included verbatim in the
next Claude invocation's prompt file, so the user can push back like in a GitHub review.

**Streaming:** hunks arrive top-down one at a time; empty state reads "Claude is reading your
marks. 14 marks · 3 files · started 12:04. · · · first hunk in a moment." No spinner.

### Reviewer write-up output

Markdown only. RTF is `pandoc review.md -o review.rtf` — shipping a converter is scope creep.
Structured first draft with category → section map:

```
# Review · <title>
## Summary      (Claude-authored, 4 sentences)
## Strengths    (praise)
## Weaknesses   (wrong + weak-argument)
## Clarity      (unclear + rephrase)
## Citations    (citation-needed)
## Minor        (everything else)
```

Section map is editable in project settings, not in the wizard. In-app serif textarea for
refinement; "Save to folder" and "Copy to clipboard" — no cloud.

### Voice

Observational, declarative, slightly archaic. No exclamations. Verbs over adjectives. Register
matches existing landing hero "Writing a paper with AI is cheap. / Reviewing it is the work."

Examples:
- Wizard heading: "First, the machinist."
- Diff empty: "Claude is reading your marks. First hunk in a moment."
- Deleting project: "Forget this project. Your files stay where they are."
- Export confirm: "Written to intro.tex. Nothing was sent anywhere."

## Critical files

**To modify:**

- `packages/bundle-schema/src/schema.ts` — add v2 with discriminated anchor union, multi-paper
- `packages/claude-plugin/skills/plan-fix/SKILL.md` — additionally emit `.obelus/plan-<ts>.json`
- `packages/claude-plugin/skills/apply-review/SKILL.md` — dispatch on bundleVersion
- `apps/web/src/storage/schema.ts` / `repositories.ts` — extracted to `packages/repo`
- `apps/web/src/bundle/build.ts` — moved to `packages/bundle-builder`, generalized
- `apps/web/src/annotations/*.ts` + `apps/web/src/pdf/*.tsx` — extracted to `packages/anchor`, `packages/pdf-view`
- `apps/web/src/styles/tokens.css` — moved to `packages/design-tokens`, add diff-old/new tokens
- `apps/web/src/routes/review/CategoryPicker.tsx` — categories become per-project, schema in `packages/categories`

**To create:**

- `apps/desktop/src-tauri/` — Cargo.toml, tauri.conf.json, Rust commands for claude-sidecar,
  fs-scoped access, project scanner, diff-hunk SQLite, file watcher
- `apps/desktop/src/` — React renderer: wizard, home, project view (writer/reviewer/stack),
  file tree, source/HTML split, diff review column, project settings slide-over
- `packages/claude-plugin/skills/apply-review-v2/SKILL.md` — v2 dispatch target
- `packages/source-render/` — tectonic + tex4ht wrapper, pandoc fallback, typst experimental,
  remark for markdown; emits source-mapped HTML
- `packages/claude-sidecar/` — Rust + TS event contract
- `packages/repo/src/sqlite/` — schema + migrations
- `scripts/guard-desktop-only.mjs` — CI guard: `apps/web` must not import desktop-only packages
- `fixtures/render-corpus/` — 20 real arXiv papers for source-render fidelity tests

## Roadmap

Estimates are rough order-of-magnitude; adjust as we learn.

### Status (2026-04-20)

Phases 0 – 4.5 shipped. Phase 6 (part 1) shipped — stack mode + `draft-writeup`.
Phase 5 (HTML source preview) **deferred post-v1**; Phase 6 custom section map
and consolidated-packet export **deferred post-v1**. **Phase 7 complete** —
ready to cut a v1 release.

**Phase 7 — shipped:**

- [x] 7.1 Docs reconciliation — `230fe31`
- [x] 7.2 Anchor round-trip fixture CI — `39ff574` (pdf-lib fixture + 4 cases)
- [x] 7.3 `obelus://` URL scheme — `a3f1638` (v1: `obelus://open?path=…`)
- [x] 7.4 Landing "Desktop" section — `d9f33e2` (placeholder downloads)
- [x] 7.5 GitHub Actions release pipeline — `1383ed6` (tag-triggered, unsigned)
- [x] 7.6 Tauri updater — `e3f60a1` (settings UI + README setup docs)

**Before cutting the first release:**

1. Generate the updater keypair (`pnpm -C apps/desktop tauri signer generate …`).
2. Paste the pubkey into `apps/desktop/src-tauri/tauri.conf.json` under
   `plugins.updater.pubkey`; add the private key + password as GitHub secrets
   `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
3. Push a `v*` tag; the release workflow builds all four targets and drafts a
   Release, then flips it public on success.
4. After the first run, swap the four `<span className="desktop__link--pending">`
   placeholders on the landing page for real `<a href>` download links.

### Phase 0 — Foundation (no user-visible change)

- Extract shared packages: `anchor`, `pdf-view`, `repo` (interface + Dexie impl moved),
  `bundle-builder`, `categories`, `design-tokens`
- PWA stays green throughout; CI guard enforces no desktop imports from `apps/web`
- Ship as a patch release of the PWA — validates the extraction

### Phase 1 — Bundle v2 + plugin dual-dispatch

- `packages/bundle-schema`: add v2 schema with discriminated anchor union, multi-paper, project
  envelope with categories
- `packages/claude-plugin`: `apply-review-v2` skill, `plan-fix` emits `.obelus/plan-<ts>.json`
- Keep v1 path untouched; plugin reads `bundleVersion` and dispatches
- Tests: fixtures for v1 bundle (existing), v2 bundle (new) — both pass `pnpm verify`

### Phase 2 — Tauri shell + wizard + home

- `apps/desktop/` skeleton, Tauri v2 config, plugins wired
- Rust: SQLite schema + migrations, `plugin-store` for app-state, FS-scope command wrappers,
  `claude` detection + version check
- Renderer: wizard (3 folios), home (reuse library row pattern), global settings
- Smoke test: pick a folder, persist to SQLite, re-open on next launch

### Phase 3 — Writer mode (PDF + source, no HTML render yet)

- File tree, center swap for `.pdf` (reuses `pdf-view`), source editor (monaco-lite or
  textarea — decide inline), per-project category editor
- Save annotations to SQLite repo; export v2 bundle
- Run end-to-end: mark → bundle → `claude --print` → read `plan-<ts>.json` → display in diff
  column (read-only for now)

### Phase 4 — Diff review UI + apply semantics

- Diff column UI (PR-review style, palette tokens, keyboard economy)
- SQLite-backed hunk state, inline edit, comment-for-next-pass
- Apply-all-accepted atomic write; backups in `.obelus/backup/<session-id>/`
- Optional git mode (off by default)

### Phase 4.5 — Ask panel (free-form Q&A)

- Third tab "Ask" in `ReviewColumn` alongside Marks / Diff; project-scoped, available
  even when no PDF is open
- Sidecar gains `claude_ask` (sibling of `claude_spawn`) — single-shot `claude --print`
  with `--add-dir` and `--allowedTools "Read Glob Grep"`, no plugin-dir
- Persistence: `ask_threads` + `ask_messages` SQLite tables (migration 0004), one thread
  per `(project_id, paper_id NULL-able)`; web repo throws `NotSupportedError`
- Renderer assembles prompt with project + open paper + selected mark + last ~6 turns,
  streams stdout into the assistant message body
- Read-only floor: Claude answers questions; edits still go through the diff path

### Phase 5 — HTML source preview (rendered writer mode) — **deferred post-v1**

Skipped for v1 release. Writer mode ships with a source editor only; HTML
preview and `SourceAnchor` land after v1 when the LaTeX renderer cost
decision has real usage data behind it.

- `packages/source-render`: markdown (remark) first, then Pandoc, then Tectonic+tex4ht
- Source-map injection (`data-src-file/line/col`)
- Selection-to-SourceAnchor + verifier round-trip
- Render-failed pane state
- Typst stays behind an experimental flag

### Phase 6 — Reviewer + stack modes, write-up drafting

Shipped in v1:
- Single-PDF project kind (wraps in same project shell)
- Stack project kind (folder of PDFs, sidebar list)
- Draft-the-write-up pipeline with a built-in category → section map
- Per-paper write-up save (one `.md` per paper under `.obelus/`)

Deferred post-v1:
- Custom category → section map editable in project settings
- Consolidated-packet export across a stack

### Phase 7 — Polish + release

- Docs: README, `docs/plan.md` status, landing "Desktop" section with download links
- Anchor round-trip fixture CI (the LaTeX half of this item defers with Phase 5)
- `obelus://` URL scheme for PWA → desktop handoff
- GitHub Actions release pipeline: tag push → macOS (arm64 + x64), Windows x64,
  Linux x64 AppImage via `tauri-action`, artifacts on GitHub Releases
- Tauri updater with a free minisign keypair (updater signs its manifest; OS-level
  code signing is **not** in v1 — unsigned builds ship with a short first-launch
  note in the README for macOS Gatekeeper + Windows SmartScreen)

## Verification

- `pnpm verify` green at every phase
- PWA build stays offline-pure (`pnpm guard:network` + new `guard:desktop-only`)
- Manual: PWA still reviews PDFs, exports v1 bundle; existing plugin still applies v1
- Manual (desktop): wizard → pick source folder → highlight PDF + source → run Claude →
  review diff → apply → source file changes on disk, `.obelus/backup/` retains original
- Fixture tests: PDF anchor round-trip (LaTeX render fidelity corpus lands with Phase 5)
- Plugin: both v1 and v2 bundles accepted by `packages/claude-plugin verify`

## Open decisions (call these before coding Phase 3+)

1. **LaTeX renderer cost.** Recommend Tectonic + tex4ht (~80 MB per-platform binary, full
   fidelity). Alternatives: Pandoc-only (~15 MB, weaker math fidelity) or require user-installed
   `pdflatex`/`tectonic` on PATH (same trust model as `claude`). This is the largest single cost
   in the download and worth an explicit call.
2. **Writer mode without a PDF.** Can a user open a source-only folder and annotate on the
   rendered HTML preview with no companion PDF? Recommend yes — schema supports it, unblocks
   "mid-draft reviewing." Confirm.
3. **Git integration default.** Shell to `git` if `.git` exists: off by default, togglable per
   project? Or ship later? Recommend off-by-default in v1; revisit after user feedback.
4. **PWA long-term.** Freeze PWA at v1 bundle export forever, or eventually backport v2 (and
   HTML selection)? Recommend freeze — the PWA's job is "try the surface," not feature parity.
   Confirm.
5. **Cmd-k scope.** Projects + files only, not hunks. Recommend this — hunks are serial j/k
   territory. Confirm.

## Risks (top 5)

1. **LaTeX→HTML fidelity for exotic class files** — mitigated by fixture suite + "source
   preview unavailable" fallback to PDF-only for that paper + user-selectable Pandoc alternative
2. **Claude CLI surface drift across versions** — floor + ceiling version in wizard; weekly CI
   smoke test against latest `claude` release; plugin version is ours, shipped with the app
3. **SQLite migrations without a server** — forward-only monotonic numbering, pre-migration
   backup, property-based invariant tests
4. **Tauri v2 plugin ecosystem maturity** — pin plugin versions, keep renderer portable so a
   fallback path ("local HTTP server + system browser") is a week away if Tauri falls over
5. **Source-map correctness (wrong line anchored)** — every SourceAnchor passes a round-trip
   verifier; mismatch falls back to v1 fuzzy anchor with `sourceMapUnverified: true`
