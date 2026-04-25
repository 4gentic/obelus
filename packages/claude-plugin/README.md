# Obelus — Claude Code plugin

Applies an [Obelus](https://github.com/4gentic/obelus) bundle to the paper source in your repository, or turns it into a reviewer write-up. Works with LaTeX, Markdown, and Typst. Runs entirely inside Claude Code; the plugin itself makes no network calls.

## Install

Two paths:

1. **From GitHub.** In Claude Code, add the marketplace and install the plugin:
   ```
   /plugin marketplace add 4gentic/obelus
   /plugin install obelus@4gentic
   ```
   The plugin ships in `packages/claude-plugin/` of that monorepo.
2. **Copy.** Drop this folder at `.claude/plugins/obelus/` inside your paper repo. Restart Claude Code so it picks up the new plugin.

## Flow

1. Review a PDF in the Obelus web app. Export the bundle.
2. Save the bundle somewhere your paper repo can see it (default: `~/Downloads/obelus-review-YYYY-MM-DD.json` or `obelus-revise-YYYY-MM-DD.json`).
3. In Claude Code, inside the paper repo, run **one of**:
   - `/apply-revision <bundle>` — turn the marks into minimal-diff source edits.
   - `/write-review <bundle>` — turn the marks into a Markdown reviewer's letter, rendered inline in your conversation. Add `--out` (optionally with a path) to write it to `.obelus/writeup-<paper-id>-<iso>.md` instead; the Obelus desktop app's review pane uses this.
4. For `apply-revision`: the plugin validates the bundle, detects your source format, and plans the edits in a forked context, writing the plan to `.obelus/plan-<timestamp>.md`.
5. Read the plan. If it looks right, run `/apply-fix .obelus/plan-<timestamp>.md`. Edits are applied one block at a time. Any annotation the planner couldn't locate with high confidence is skipped and surfaced in the summary.

If format detection can't find a single confident entrypoint, run `/apply-revision <bundle> --entrypoint <path>` to pin it explicitly.

## Skills

| Skill           | Purpose                                                                           | User-invocable |
| --------------- | --------------------------------------------------------------------------------- | -------------- |
| `apply-revision`   | Entry point for source edits. Validates, classifies source format inline, invokes `plan-fix`. | Yes            |
| `write-review`  | Drafts a Markdown reviewer's letter from the bundle. Renders inline by default; pass `--out` for a file. | Yes            |
| `apply-fix`     | Executes an approved plan with the Edit tool. Skips ambiguous blocks.             | Yes            |
| `plan-fix`      | Forks context, locates each annotation in source, writes the plan file.           | No (internal)  |

Both `apply-revision` and `write-review` validate the bundle against the canonical JSON Schema at `${CLAUDE_PLUGIN_ROOT}/schemas/bundle.schema.json` before doing anything else.

## Safety

- The plugin performs no network calls. Claude Code's own tools follow its harness policy.
- `apply-fix` is user-invocable only — it won't run without you asking for it by name.
- The planner annotates anything it can't locate as `ambiguous`; those blocks are skipped, never guessed at.
- Nothing is written to your source tree until you approve the plan.

## Bundle contract

See `@obelus/bundle-schema` in the monorepo. The plugin ships a copy of the canonical JSON Schema at `schemas/bundle.schema.json` inside this directory — the skills resolve it via `${CLAUDE_PLUGIN_ROOT}/schemas/…` so validation works out of the box when the plugin is installed from the marketplace.

## End-to-end tests

The skills are prompted, not coded — so a working plugin today can regress silently tomorrow when Claude Code or the default model changes. `pnpm plugin:e2e` (at the repo root) runs four real Claude Code sessions against this plugin and asserts that:

| # | Scenario | Skill | Expected |
| --- | --- | --- | --- |
| 1.1 | V1 bundle alone, `--out` passed | `write-review` | Markdown letter at `.obelus/writeup-*.md` with `# Review ·` heading, annotation traces, and the `OBELUS_WROTE:` marker on stdout. |
| 1.2 | V1 bundle + `.tex`/`.md`/`.typ` alongside, `--out` passed | `write-review` | Same letter — co-located sources are ignored. |
| 1.3 | V1 bundle alone, no flag (inline default) | `write-review` | Markdown letter in stdout (final assistant message); no `.obelus/` directory created, no `OBELUS_WROTE:` marker. |
| 2.1 | V1 bundle, no sources in cwd | `apply-revision` | Graceful refusal; `/obelus:write-review` suggested; no plan written. |
| 2.2 | V1 bundle + `.tex` source | `apply-revision` | `.obelus/plan-*.md` and `plan-*.json` written. |

Auth is auto-detected: `ANTHROPIC_API_KEY` → metered mode with `--bare`; otherwise the harness reads the keychain OAuth from `claude /login` (no per-call cost). Temp dirs default to `$TMPDIR/obelus-plugin-e2e/` so subscription mode doesn't pull the repo's `CLAUDE.md` into the test sessions. The same suite runs weekly on GitHub Actions (`.github/workflows/plugin-e2e.yml`) and opens a rolling issue on regression.

See `scripts/plugin-e2e.mjs` for the harness and `.claude/commands/plugin-e2e.md` for the full how-to.

## License

MIT.
