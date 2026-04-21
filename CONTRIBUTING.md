# Contributing

Thanks for caring enough to open this file.

## Before you write code

Read, in order:

1. `README.md` — what Obelus is.
2. `CLAUDE.md` — the aesthetic and code invariants. They are not negotiable.
3. `docs/plan.md` — the design brief.
4. The persona charter in `.claude/agents/` that owns the area you're changing. There are five: **Typesetter** (CSS, type, layout), **Archivist** (storage, PWA, offline guarantees), **Compositor** (PDF rendering, anchoring), **Scribe** (bundle schema, Claude Code plugin), **Proofreader** (CI, lint, strict TS, final audit).

## Ground rules

- **One concern per PR.** A bug fix doesn't need surrounding cleanup.
- **No comments that restate code.** Only the *why* when it's non-obvious.
- **No runtime network** anywhere in the app. The CI `guard:network` script will fail your PR otherwise.
- **Biome clean.** `pnpm verify` must pass locally before you push.
- **No dependencies for three lines of code.** We'd rather write the three lines.

## Submitting

1. Fork, branch from `main`.
2. Run `pnpm verify`.
3. Open a PR with a short body: *what changed*, *why*, *how you tested*.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/). The release tooling parses commit subjects to bump the version and write the changelog, so getting the prefix right matters more than perfect prose.

The prefixes that appear in the changelog:

- `feat:` — a new user-visible capability (minor bump)
- `fix:` — a user-visible bug fix (patch bump)
- `perf:` — a performance improvement (patch bump)
- `refactor:` — internal restructure with no behavior change
- `docs:` — documentation only

Hidden from the changelog but still allowed: `chore:`, `test:`, `build:`, `ci:`, `style:`.

Breaking changes get a `!` after the type (`feat!: drop bundle v0`) or a `BREAKING CHANGE:` footer; both trigger a major bump. While we're pre-1.0, breaking changes bump the minor instead.

## Releases

Releases are automated and scoped per shippable component — the desktop app (`apps/desktop`) and the Claude Code plugin (`packages/claude-plugin`). Web-only changes deploy continuously from `main` and are not released. [release-please](https://github.com/googleapis/release-please) opens a rolling `chore(desktop): release vX.Y.Z` or `chore(plugin): release vX.Y.Z` PR only when commits touch that component's path.

Merging a desktop release PR tags `desktop-vX.Y.Z`, drafts a GitHub Release, and triggers `release.yml`, which builds Tauri binaries for macOS (arm64 + x86_64), Linux, and Windows, attaches them, then publishes. Merging a plugin release PR tags `plugin-vX.Y.Z` and publishes a source-only release with the changelog.

You don't tag manually. You don't bump versions manually. Just write good commit messages and merge the release PR when it's time to ship. See [`docs/RELEASING.md`](docs/RELEASING.md) for the mapping from paths to tags to changelogs.

## Where to start

Issues labeled `good-first-mark` are scoped for a first contribution: small enough to land in one sitting, narrow enough that the change touches one persona's charter. Maintainers apply the label when opening or triaging issues.
