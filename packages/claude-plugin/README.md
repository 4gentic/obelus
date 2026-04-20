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
2. Save the bundle somewhere your paper repo can see it (default: `~/Downloads/obelus-YYYY-MM-DD.json`).
3. In Claude Code, inside the paper repo, run **one of**:
   - `/apply-marks <bundle>` — turn the marks into minimal-diff source edits.
   - `/write-review <bundle>` — turn the marks into a Markdown reviewer's letter, printed to stdout.
4. For `apply-marks`: the plugin validates the bundle, detects your source format, and plans the edits in a forked context, writing the plan to `.obelus/plan-<timestamp>.md`.
5. Read the plan. If it looks right, run `/apply-fix .obelus/plan-<timestamp>.md`. Edits are applied one block at a time. Any annotation the planner couldn't locate with high confidence is skipped and surfaced in the summary.

If format detection can't find a single confident entrypoint, run `/apply-marks <bundle> --entrypoint <path>` to pin it explicitly.

## Skills

| Skill           | Purpose                                                                           | User-invocable |
| --------------- | --------------------------------------------------------------------------------- | -------------- |
| `apply-marks`   | Entry point for source edits. Validates, detects format, invokes `plan-fix`.      | Yes            |
| `write-review`  | Drafts a Markdown reviewer's letter from the bundle. Prints to stdout.            | Yes            |
| `apply-fix`     | Executes an approved plan with the Edit tool. Skips ambiguous blocks.             | Yes            |
| `detect-format` | Walks the repo, emits `{ format, entrypoint, sourceFiles }` as JSON.              | No (internal)  |
| `plan-fix`      | Forks context, locates each annotation in source, writes the plan file.           | No (internal)  |

Both `apply-marks` and `write-review` dispatch internally on `bundleVersion` (1.0 / 2.0).

## Safety

- The plugin performs no network calls. Claude Code's own tools follow its harness policy.
- `apply-fix` is user-invocable only — it won't run without you asking for it by name.
- The planner annotates anything it can't locate as `ambiguous`; those blocks are skipped, never guessed at.
- Nothing is written to your source tree until you approve the plan.

## Bundle contract

See `@obelus/bundle-schema`. JSON Schemas live at `@obelus/bundle-schema/json-schema/v1` and `@obelus/bundle-schema/json-schema/v2`.

## License

MIT.
