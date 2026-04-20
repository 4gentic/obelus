---
name: apply-review-v2
description: Apply an Obelus v2 review bundle (multi-paper, anchor union) to paper source in this repo.
argument-hint: <bundle-path>
disable-model-invocation: true
allowed-tools: Read Glob Grep
---

# Apply review (v2)

Entry point for bundles with `bundleVersion: "2.0"`. A v2 bundle carries a project envelope with per-project categories, one or more papers, and annotations whose `anchor` is a discriminated union (`pdf` | `source` | `html`).

Invoked by the `apply-review` dispatcher when it detects `bundleVersion: "2.0"`. Do not handle v1 bundles here — refuse.

## Steps

1. **Read and validate.** Read the JSON at `<bundle-path>`. Validate against `@obelus/bundle-schema/json-schema/v2` (resolves to `packages/bundle-schema/dist/bundle-v2.schema.json`). If invalid, print the first three errors and stop. Confirm `bundleVersion === "2.0"`; if it is anything else, refuse.

2. **Per-paper preflight.** For each entry in `bundle.papers`:

   a. **PDF hash check (optional).** If `paper.pdf?.relPath` is present and the file exists in the repo, compute its SHA-256 and compare to `paper.pdf.sha256`. On mismatch, warn but continue and record it in the summary.

   b. **Format descriptor.** Prefer `paper.entrypoint` when present — use it directly and infer `format` from the extension (`.tex` → `latex`, `.md` → `markdown`, `.typ` → `typst`). Otherwise invoke the `detect-format` skill. If format is `"unknown"`, stop and ask the user to confirm the entrypoint for that paper.

3. **Plan.** Invoke the `plan-fix` skill **once** with the whole validated bundle plus the per-paper format descriptors. `plan-fix` writes `.obelus/plan-<timestamp>.md` and a machine-readable companion `.obelus/plan-<timestamp>.json`. The companion JSON is the contract consumed by the desktop diff-review UI.

4. **Report.** Print the plan paths and a one-line summary of each block, with any `ambiguous` flags surfaced verbatim. Group summary lines by paper.

5. **Hand off.** Tell the user:
   > Read the plan at `<path>`. When you're ready to apply it, run:
   > `/skill apply-fix <path>`

   Do not invoke `apply-fix` yourself. The machine-readable `.json` companion is for the desktop UI; the user-triggered `apply-fix` still reads the `.md`.

## Refusals

- Do not proceed past a schema error.
- Do not accept a v1 bundle here; `bundleVersion` must be `"2.0"`.
- Do not edit any source file in this skill.
- Do not prompt the user to auto-apply.
