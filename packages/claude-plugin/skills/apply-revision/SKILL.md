---
name: apply-revision
description: Apply the marks in an Obelus bundle as a revision — minimal-diff edits to this paper's source.
argument-hint: <bundle-path> [--entrypoint <path>]
disable-model-invocation: true
allowed-tools: Read Glob Grep
---

# Apply revision

Entry point. The user passes a path to an Obelus bundle exported from the web or desktop app. This skill takes each mark and turns it into a minimal-diff edit on the paper source — a revision pass. It does **not** write a review — see `write-review` for that.

Optional second argument: `--entrypoint <path>` forces the paper source to the supplied file, skipping format detection.

## Steps

1. **Read the bundle.** Read the JSON at `<bundle-path>`. If unreadable, stop and tell the user why.

2. **Dispatch on `bundleVersion`.** Parse the JSON far enough to read the top-level `bundleVersion` field before full validation.
   - `"1.0"` → continue with the v1 flow (steps 3–7).
   - `"2.0"` → continue with the v2 flow (steps 3v2–7v2).
   - anything else (including missing) → refuse with `"unsupported bundleVersion: <value>"` and stop.

## v1 flow

3. **Validate (v1).** Load the JSON Schema from `@obelus/bundle-schema/json-schema/v1` (resolves to `packages/bundle-schema/schemas/bundle-v1.schema.json`).
   - If the pinned schema file is not present at the resolved path, **stop and fail** with: `"cannot validate bundle: schema artifact <path> is missing; reinstall the plugin"`. Do not fall back to a lenient parse, the shipped Zod types, or a schema fetched from anywhere else — the pinned artifact is the contract.
   - Validate the bundle against it. If invalid, print the first three errors and stop — do not guess the shape.

4. **Check the PDF hash, if present.** If a PDF filename in the bundle matches a file in the repo, compute its SHA-256 and compare to `pdf.sha256`. On mismatch, warn but continue — the source may have moved since the PDF was rendered. Note it in the summary.

5. **Locate the paper source.**
   - If `--entrypoint <path>` was supplied, use it directly. Infer `format` from the extension (`.tex` → `latex`, `.md` → `markdown`, `.typ` → `typst`). If the extension isn't one of those, stop and say so.
   - Otherwise invoke the `detect-format` skill as an internal sub-step. Parse the fenced JSON descriptor it returns; **do not echo that JSON to the user**.
   - On success, narrate one short sentence: `Detected <format> source at <entrypoint>.` If the descriptor has a `notes` field, append a second sentence based on it — e.g. `Two <format> entrypoints found — picked <chosen> (most recently modified).` No structured block, no JSON.
   - On `format === "unknown"`, stop with exactly this message:

     > I couldn't find a single `.tex`, `.md`, or `.typ` entrypoint in this repo with high enough confidence. Tell me which file to use and I'll continue:
     >
     > `/apply-revision <bundle-path> --entrypoint <path-to-entrypoint>`
     >
     > Or move to a folder that has exactly one candidate and rerun.

6. **Plan.** Invoke the `plan-fix` skill with the validated bundle and the format descriptor. It runs in a forked context and writes `.obelus/plan-<timestamp>.md` together with a companion `.obelus/plan-<timestamp>.json`. When it returns, print the plan paths and a one-line summary of each block (with any `ambiguous` flags made visible).

7. **Hand off.** Tell the user:

   > Read the plan at `<path>`. When you're ready to apply it, run:
   > `/skill apply-fix <path>`

   Do not invoke `apply-fix` yourself. It is user-triggered by design.

## v2 flow

3v2. **Validate (v2).** Load the JSON Schema from `@obelus/bundle-schema/json-schema/v2` (resolves to `packages/bundle-schema/schemas/bundle-v2.schema.json`). Same missing-schema behaviour as v1.
   - Validate the bundle against it. If invalid, print the first three errors and stop. Confirm `bundleVersion === "2.0"`.

4v2. **Per-paper preflight.** For each entry in `bundle.papers`:

   a. **PDF hash check (optional).** If `paper.pdf?.relPath` is present and the file exists in the repo, compute its SHA-256 and compare to `paper.pdf.sha256`. On mismatch, warn but continue and record it in the summary.

   b. **Locate the paper source.** Precedence:
      - If `--entrypoint <path>` was supplied (single-paper case only), use it. For multi-paper bundles, refuse `--entrypoint` and tell the user to omit it.
      - Else if `paper.entrypoint` is present in the bundle, use it and infer `format` from the extension.
      - Else invoke `detect-format` silently. Narrate one sentence per paper (`Detected <format> source at <entrypoint> for <paper title>.`). On `format === "unknown"`, stop with the same prose message as v1, scoped to the specific paper.

5v2. **Plan.** Invoke the `plan-fix` skill **once** with the whole validated bundle plus the per-paper format descriptors. `plan-fix` writes `.obelus/plan-<timestamp>.md` and a companion `.obelus/plan-<timestamp>.json`. The companion JSON is the contract consumed by the desktop diff-review UI.

6v2. **Report.** Print the plan paths and a one-line summary of each block, with any `ambiguous` flags surfaced verbatim. Group summary lines by paper.

7v2. **Hand off.** Tell the user:

   > Read the plan at `<path>`. When you're ready to apply it, run:
   > `/skill apply-fix <path>`

   Do not invoke `apply-fix` yourself. The machine-readable `.json` companion is for the desktop UI; the user-triggered `apply-fix` reads the `.md`.

## Refusals

- Do not proceed past an unsupported or missing `bundleVersion`.
- Do not proceed past a schema error.
- Do not echo `detect-format`'s raw JSON to the user — always narrate in prose.
- Do not edit any source file in this skill.
- Do not prompt the user to auto-apply; `apply-fix` must be explicitly requested.
