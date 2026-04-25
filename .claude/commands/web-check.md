---
description: Run the web app's e2e matrix — every paper format × tab × export — to verify review/revise flows without manual clicking.
allowed-tools: Bash
argument-hint: "[playwright args]  # e.g. --headed, -g 'HTML.*Copy'"
---

# /web-check

Drive the `apps/web` review/revise flows in a real browser and assert the three outputs that matter for every paper format. Catches regressions you would otherwise only notice by clicking through the app yourself.

## What it covers

Three paper formats × two tabs × three outputs = 18 cells, all in `apps/web/e2e/exports.spec.ts`.

| Format | Tab    | Outputs verified                                  |
|--------|--------|---------------------------------------------------|
| PDF    | Review | JSON bundle · Markdown bundle · Copy to clipboard |
| PDF    | Revise | JSON bundle · Markdown bundle · Copy to clipboard |
| HTML   | Review | JSON bundle · Markdown bundle · Copy to clipboard |
| HTML   | Revise | JSON bundle · Markdown bundle · Copy to clipboard |
| MD     | Review | JSON bundle · Markdown bundle · Copy to clipboard |
| MD     | Revise | JSON bundle · Markdown bundle · Copy to clipboard |

Each cell asserts:

- **Downloads** carry a filename matching `obelus-(review|revise)-*.(json|md)` and a body that round-trips through the bundle/prompt schema for *this* paper (title, category, quote, anchor kind).
- **Copy to clipboard** lands the prompt text on `navigator.clipboard` — and **never** triggers a file download. This is the regression guard for "outputs in files instead of inline".
- **Anchor kind matches format** — `pdf` for PDF, `source` for MD, `html` for hand-authored HTML. Catches schema drift where a format silently emits the wrong anchor shape.

The legacy `apps/web/e2e/review.spec.ts` (PDF mark/save/persist/delete) and `landing.spec.ts` / `library.spec.ts` are also picked up by the same Playwright project, so a `/web-check` run is a full e2e sweep.

## Execution

Run the suite from the repo root:

```
pnpm --filter @obelus/web e2e
```

Forward Playwright flags as arguments to the slash command:

- `--headed` — watch the browser drive every cell. Useful for debugging a flow you've broken.
- `-g <pattern>` — run a single cell. Examples:
  - `-g "HTML exports.*Copy"` — only the HTML clipboard tests
  - `-g "MD exports.*revise"` — all three Revise outputs for the Markdown paper

Concretely:

```
pnpm --filter @obelus/web e2e -- --headed -g "MD exports"
```

## Reading the result

1. Run the command above (with any forwarded flags).
2. On all-pass: confirm the matrix is green and that the inline-clipboard guard held. The full Playwright report is at `apps/web/playwright-report/` if the user wants to inspect timings or screenshots.
3. On failure:
   - Surface the failing test name(s) verbatim — they encode the cell, e.g. `HTML exports › revise: Copy to clipboard lands inline, not as a file`.
   - Note that traces, screenshots, and videos for failures are saved under `apps/web/test-results/` (per `apps/web/playwright.config.ts`).
   - Offer to open `apps/web/playwright-report/index.html` for a clickable failure breakdown.
   - Do not retry on failure unless the user asks. Flake masks regressions.

## Notes

- The Playwright config runs single-worker (`workers: 1`) and not in parallel — IDB / OPFS state isolation depends on it.
- The fixtures live at `apps/web/e2e/fixtures/{minimal.pdf,sample.md,sample.html}`. `sample.md` and `sample.html` are copies of `packages/claude-plugin/fixtures/sample/` and intentionally cover both the `source` anchor path (MD) and the `html` anchor path (hand-authored HTML).
- The clipboard read uses Playwright's permission grants from `apps/web/playwright.config.ts:19` — no extra setup required.
