---
name: apply-review
description: Apply an Obelus review bundle to the paper source in this repo.
argument-hint: <bundle-path>
disable-model-invocation: true
allowed-tools: Read Glob Grep
---

# Apply review

Entry point. The user passes a path to an Obelus review bundle.

## Steps

1. **Read the bundle.** Read the JSON at `<bundle-path>`. If unreadable, stop and tell the user why.

2. **Dispatch on `bundleVersion`.** Parse the JSON far enough to read the top-level `bundleVersion` field before full validation.
   - `"1.0"` → continue with steps 3–7 below (the v1 flow).
   - `"2.0"` → delegate. Invoke the `apply-review-v2` skill with the same `<bundle-path>`. Report its result to the user and stop — do not continue with the v1 steps.
   - anything else (including missing) → refuse with `"unsupported bundleVersion: <value>"` and stop.

3. **Validate.** Load the JSON Schema from `@obelus/bundle-schema/json-schema/v1` (resolves to `packages/bundle-schema/dist/bundle-v1.schema.json`).

   - If the pinned schema file is not present at the resolved `dist/` path, **stop and fail** with: `"cannot validate bundle: schema artifact <path> is missing; reinstall the plugin or run the bundle-schema build"`. Do not fall back to a lenient parse, the shipped Zod types, or a schema fetched from anywhere else — the pinned artifact is the contract.
   - Validate the bundle against it. If invalid, print the first three errors and stop — do not guess the shape. The bundle is the contract.

4. **Check the PDF hash, if present.** If a PDF filename in the bundle matches a file in the repo, compute its SHA-256 and compare to `pdf.sha256`. On mismatch, warn but continue — the source may have moved since the PDF was rendered. Note it in the summary.

5. **Detect format.** Invoke the `detect-format` skill. You will receive a descriptor `{ format, entrypoint, sourceFiles }`. If `format` is `"unknown"`, stop and ask the user to confirm the entrypoint.

6. **Plan.** Invoke the `plan-fix` skill with the validated bundle and the format descriptor. It runs in a forked context and writes `.obelus/plan-<timestamp>.md` together with a companion `.obelus/plan-<timestamp>.json`. When it returns, print the plan paths and a one-line summary of each block (with any `ambiguous` flags made visible).

7. **Hand off.** Tell the user:
   > Read the plan at `<path>`. When you're ready to apply it, run:
   > `/skill apply-fix <path>`

   Do not invoke `apply-fix` yourself. It is user-triggered by design.

## Refusals

- Do not proceed past an unsupported or missing `bundleVersion`.
- Do not proceed past a schema error.
- Do not edit any source file in this skill.
- Do not prompt the user to auto-apply; `apply-fix` must be explicitly requested.
