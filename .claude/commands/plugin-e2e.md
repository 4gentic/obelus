---
description: Run the Obelus plugin E2E suite — four real Claude Code sessions against the local plugin, asserting write-review and apply-revision behavior.
allowed-tools: Bash
---

# /plugin-e2e

End-to-end check of the plugin's two user-facing skills, executed as real `claude -p --bare --plugin-dir packages/claude-plugin` sessions against the sample fixture. Catches regressions from Claude Code updates, model drift, and schema shipping bugs that unit tests can't see.

## What it covers

| # | Scenario | Skill | Must observe |
|---|----------|-------|--------------|
| 1.1 | `review-single` | `write-review` | Valid letter from a V1 bundle alone. |
| 1.2 | `review-with-sources` | `write-review` | Same letter when `.tex`/`.md`/`.typ` are co-located — sources must be ignored. |
| 2.1 | `revise-no-sources` | `apply-revision` | Graceful refusal ("I can't apply this revision") with `/obelus:write-review` fallback; no plan file written. |
| 2.2 | `revise-with-sources` | `apply-revision` | `.obelus/plan-*.md` and `.obelus/plan-*.json` written; no refusal. |

## Prerequisites

- `claude` CLI on PATH (`npm i -g @anthropic-ai/claude-code`).
- **One of two auth paths:**
  - **API key (metered):** export `ANTHROPIC_API_KEY`. The harness runs in `--bare` mode for maximum isolation. Best for CI.
  - **Subscription (no per-call cost):** run `claude /login` once to store OAuth in the keychain, then invoke with no env key set. The harness detects this automatically and drops `--bare` so keychain reads are allowed.
- The auth path is auto-selected. Force one with `OBELUS_E2E_AUTH=api-key` or `OBELUS_E2E_AUTH=subscription`.
- Temp dirs default to `$TMPDIR/obelus-plugin-e2e/` (outside the repo, so subscription mode doesn't pull project `CLAUDE.md` into the test sessions). Override with `OBELUS_E2E_TMP_DIR=<path>`.

## Execution

1. Run `pnpm plugin:e2e` from the repo root. The harness:
   - Stages each scenario into the temp root (see Prerequisites).
   - Spawns `claude -p [--bare] --plugin-dir packages/claude-plugin ...` per scenario with `bypassPermissions`, `--output-format json`, and `--max-budget-usd 0.50` (`--bare` only in API-key mode).
   - Asserts on `result.result` and any files written under the scenario's `.obelus/`.
   - Prints a summary table and exits 0 on all-pass, 1 otherwise.
2. Relay the full summary block to the user verbatim. It's already human-readable.
3. On failure:
   - The harness leaves the temp root in place and prints its absolute path. Surface that path and the failing scenario names.
   - Offer to read `<tmp-root>/<failing-scenario>/.obelus/` (when present) to diagnose.
4. On success: the harness cleans the temp root itself. Confirm the repo is untouched.

## Notes for the user

- **API-key mode**: metered against the live Anthropic API, budget-capped at $0.50 per scenario (so ~$2 worst-case per full suite run).
- **Subscription mode**: no per-call cost — uses the plan attached to the logged-in Claude Code account. Counts against the plan's rate limits the same way any `claude` invocation does.
- The same harness runs on a weekly GitHub Actions cron (`.github/workflows/plugin-e2e.yml`, API-key mode, uses the `ANTHROPIC_API_KEY` repo secret).
