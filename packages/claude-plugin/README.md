# Obelus — Claude Code plugin

Applies an [Obelus](https://github.com/4gentic/obelus) review bundle to the paper source in your repository. Works with LaTeX, Markdown, and Typst. Runs entirely inside Claude Code; the plugin itself makes no network calls.

## Install

Two paths:

1. **From GitHub.** In Claude Code, run `/plugin install github:4gentic/obelus` — the plugin ships in `packages/claude-plugin/` of that monorepo.
2. **Copy.** Drop this folder at `.claude/plugins/obelus/` inside your paper repo. Restart Claude Code so it picks up the new plugin.

## Flow

1. Review your PDF in the Obelus web app. Export the bundle.
2. Save `bundle.json` somewhere your paper repo can see it.
3. In Claude Code, inside the paper repo, run:
   ```
   /skill apply-review path/to/bundle.json
   ```
4. The plugin validates the bundle, detects your source format, plans the edits in a forked context, and writes a plan file to `.obelus/plan-<timestamp>.md`.
5. Read the plan. If it looks right, run:
   ```
   /skill apply-fix .obelus/plan-<timestamp>.md
   ```
   Edits are applied one block at a time. Any annotation the planner couldn't locate with high confidence is skipped and surfaced in the summary.

## Skills

| Skill              | Purpose                                                                          | User-invocable |
| ------------------ | -------------------------------------------------------------------------------- | -------------- |
| `apply-review`     | Entry point. Validates the bundle and orchestrates `detect-format` + `plan-fix`. | Yes            |
| `apply-review-v2`  | v2-bundle entry point. Same orchestration, v2 schema.                            | Yes            |
| `apply-fix`        | Executes an approved plan with the Edit tool. Skips ambiguous blocks.            | Yes            |
| `draft-writeup`    | Drafts a reviewer write-up from the bundle.                                      | Yes            |
| `detect-format`    | Walks the repo, emits `{ format, entrypoint, sourceFiles }`.                     | No (internal)  |
| `plan-fix`         | Forks context, locates each annotation in source, writes a plan file.            | No (internal)  |

## Safety

- The plugin performs no network calls. Claude Code's own tools follow its harness policy.
- `apply-fix` is user-invocable only — it won't run without you asking for it by name.
- The planner annotates anything it can't locate as `ambiguous`; those blocks are skipped, never guessed at.
- Nothing is written to your source tree until you approve the plan.

## Bundle contract

See `@obelus/bundle-schema`. JSON Schemas live at `@obelus/bundle-schema/json-schema/v1` and `@obelus/bundle-schema/json-schema/v2`.

## License

MIT.
