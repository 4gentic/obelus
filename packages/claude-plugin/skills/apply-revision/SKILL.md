---
name: apply-revision
description: Apply the marks in an Obelus bundle as a revision — minimal-diff edits to this paper's source.
argument-hint: <bundle-path> [--entrypoint <path>]
disable-model-invocation: true
allowed-tools: Read Glob Grep Write
---

# Apply revision

Validate an Obelus bundle, locate the paper source, then delegate to `plan-fix` to produce a paired `.obelus/plan-*.md` and `.obelus/plan-*.json` describing one minimal-diff edit per mark.

The user passes a path to an Obelus bundle exported from the web or desktop app. This skill is the entry point for the revision flow; it does **not** edit source files (that is `apply-fix`) and it does **not** write a reviewer's letter (that is `write-review`).

Optional second argument: `--entrypoint <path>` forces the paper source to the supplied file, skipping format detection.

## File output contract — non-negotiable

This skill delegates the actual planning to `plan-fix`, which writes the plan files. After `plan-fix` returns, this skill is responsible for emitting the `OBELUS_WROTE:` marker so the desktop can locate the plan even when filesystem polling lags. The contract is:

1. **Plan path.** `.obelus/plan-<iso-timestamp>.md` (human) and `.obelus/plan-<iso-timestamp>.json` (machine), both relative to the current working directory.
2. **Timestamp format.** Compact UTC: `YYYYMMDD-HHmmss` — e.g. `20260423-143012`. Generate it once and use the same value for both files.
3. **Pre-flight.** Before invoking `plan-fix`, ensure `.obelus/` exists. If it does not, create `.obelus/.gitkeep` (empty body) via `Write`.
4. **Final marker line.** Once `plan-fix` reports the two paths, print exactly one line on stdout in this form, with nothing else on the line:

   ```
   OBELUS_WROTE: .obelus/plan-<iso-timestamp>.json
   ```

   Use the `.json` path (the machine-readable companion is what the desktop consumes). Print it once, at the end, after the file is on disk.

## Steps

1. **Read the bundle.** Read the JSON at `<bundle-path>`. If unreadable, stop and tell the user why.

2. **Dispatch on `bundleVersion`.** Parse the JSON far enough to read the top-level `bundleVersion` field before full validation.
   - `"1.0"` → continue with the v1 flow (steps 3–7).
   - `"2.0"` → continue with the v2 flow (steps 3v2–7v2).
   - anything else (including missing) → refuse with `"unsupported bundleVersion: <value>"` and stop.

## v1 flow

3. **Validate (v1).** Load the JSON Schema shipped with this plugin at `${CLAUDE_PLUGIN_ROOT}/schemas/bundle-v1.schema.json` (the `schemas/` directory sits next to `skills/` and `agents/` inside the plugin's install directory).
   - If the pinned schema file is not present at the resolved path, **stop and fail** with: `"cannot validate bundle: schema artifact <path> is missing; reinstall the plugin"`. Do not fall back to a lenient parse, the shipped Zod types, or a schema fetched from anywhere else — the pinned artifact is the contract.
   - Validate the bundle against it. If invalid, print the first three errors and stop — do not guess the shape.

4. **Check the PDF hash, if present.** Glob the repo for a file whose basename matches the bundle's `pdf.filename`.
   - **Found, hash matches:** stay silent; the preflight passed.
   - **Found, hash mismatches:** warn in one sentence (`The PDF <filename> is in this repo but its hash doesn't match the bundle — the source may have moved since the PDF was rendered.`) and continue. Record it for the summary.
   - **Not found:** narrate one sentence (`The PDF <filename> referenced by this bundle isn't in this repo.`) and continue. This is a hint, not a refusal — step 5 may still locate source if the user is in a repo that holds it but not the rendered PDF.

5. **Locate the paper source.** Do this inline using only `Glob` / `Read` / `Grep`. Do **not** emit any JSON block — the result of this step is a short narration in prose, then you proceed to step 6 in the same turn.

   - If `--entrypoint <path>` was supplied, use it directly. Infer the format from the extension (`.tex` → latex, `.md` → markdown, `.typ` → typst). If the extension isn't one of those, stop and say so. Otherwise skip the classification below and jump to the success narration.

   - Otherwise classify the source format:

     a. **LaTeX.** Glob `**/*.tex`. For each, read the first ~200 lines and look for `\documentclass`. The entrypoint is the file that has it (not `\input`'d from elsewhere). If multiple candidates exist, prefer `main.tex`, `paper.tex`, then the shortest path.
     b. **Typst.** Glob `**/*.typ`. Entrypoint heuristic: presence of `#set document(` or `#show:` at top level. Prefer `main.typ`, `paper.typ`, `report.typ`.
     c. **Markdown.** Glob `**/*.md` excluding `README.md`, `CHANGELOG.md`, `LICENSE.md`, `CONTRIBUTING.md`, and anything under `node_modules/`, `.git/`, `dist/`, `build/`. A Markdown paper usually has a YAML frontmatter block (`---` at line 1) with `title:` or `author:`. Prefer `paper.md`, `manuscript.md`, then the longest remaining `.md` by word count.
     d. **Conflict resolution.** If two formats both present candidates, pick the one whose entrypoint was modified most recently; the displaced one goes into a disambiguation note.
     e. **Nothing matched.** Take the unknown branch below.

   - **On success** (you found a latex, markdown, or typst entrypoint), narrate one short sentence: `Detected <format> source at <entrypoint>.` If step 5d's disambiguation fired, append a second sentence — e.g. `Two <format> entrypoints found — picked <chosen> (most recently modified).` No JSON, no code fences, no bullet list of source files. Then **continue to step 6 in the same turn** — this is a mid-flow narration, not the final answer.

   - **On nothing matched**, stop with the structured refusal below (substitute `<bundle-path>` with the path the user passed in). Pick the branch that fits, but keep the three-branch shape so the user can see all options at once:

     > **Cannot apply this revision — no `.tex`, `.md`, or `.typ` paper source found in this repo.**
     >
     > Pick whichever applies:
     >
     > - **No source available** (you annotated an arXiv PDF for peer review): use `/obelus:write-review <bundle-path>` instead — it produces a reviewer's letter from the same bundle without needing the source.
     > - **Multi-paper bundle, want to scope to one paper**: pass the entrypoint explicitly via `/obelus:apply-revision <bundle-path> --entrypoint <path-to-entrypoint>`.
     > - **Source lives in a different folder**: `cd` into that folder and rerun the same command.

6. **Plan.** Follow the `plan-fix` skill's procedure with the validated bundle and the format descriptor you computed in step 5. That procedure writes `.obelus/plan-<timestamp>.md` together with a companion `.obelus/plan-<timestamp>.json`. When the plan files are on disk, print a compact report: the two plan paths on their own lines, then a single sentence naming totals (e.g. `Wrote 3 blocks (1 citation-needed, 1 unclear, 1 praise) — 0 ambiguous.`). Do not echo per-block bodies; the user will open the plan file to read those.

7. **Hand off + marker.** Print the `OBELUS_WROTE:` marker per the **File output contract** above (the `.json` path). Then tell the user:

   > Read the plan at `<path>`. When you're ready to apply it, run:
   > `/skill apply-fix <path>`

   Do not invoke `apply-fix` yourself. It is user-triggered by design.

## v2 flow

3v2. **Validate (v2).** Load the JSON Schema shipped with this plugin at `${CLAUDE_PLUGIN_ROOT}/schemas/bundle-v2.schema.json`. Same missing-schema behaviour as v1.
   - Validate the bundle against it. If invalid, print the first three errors and stop. Confirm `bundleVersion === "2.0"`.

4v2. **Per-paper preflight.** For each entry in `bundle.papers`:

   a. **PDF hash check (optional).** If `paper.pdf?.relPath` is present, check whether the file exists at that path in the repo.
      - **Exists, hash matches:** stay silent.
      - **Exists, hash mismatches:** warn in one sentence naming the paper title and continue. Record it for the summary.
      - **Missing:** narrate one sentence (`The PDF for "<paper title>" (<relPath>) isn't in this repo.`) and continue. Step 4v2b may still find source if the repo holds it but not the rendered PDF.

   b. **Locate the paper source.** Precedence:
      - If `--entrypoint <path>` was supplied (single-paper case only), use it. For multi-paper bundles, refuse `--entrypoint` and tell the user to omit it.
      - Else if `paper.entrypoint` is present in the bundle, use it and infer `format` from the extension.
      - Else if `bundle.project.main` is present, use it as the project-wide entrypoint when the paper has no per-paper override; infer `format` from the extension. The desktop app populates `project.main` from the `project_build` cache, and mirrors the same data to `.obelus/project.json` (readable via `Read` if `bundle.project.main` is absent but the repo was opened in the desktop app).
      - Else run the classification procedure inline using only `Glob` / `Read` / `Grep` — same sub-steps as the v1 flow's step 5 (a–e). If `bundle.project.files` is present, use it as the pre-filtered candidate set instead of a fresh glob (the desktop already walked the tree for you; entries with `role: "main"` are preferred). Do **not** emit a JSON block; narrate one sentence per paper (`Detected <format> source at <entrypoint> for <paper title>.`) and continue in the same turn. On the nothing-matched branch, stop with the v1 refusal, scoped to the specific paper — name the paper title in the first sentence (e.g. `I can't apply this revision for "<paper title>" — there is no …`) and keep both fallback options (use `write-review` when the source isn't available; pass `--entrypoint` when it is).

5v2. **Plan.** Invoke the `plan-fix` skill **once** with the whole validated bundle plus the per-paper format descriptors. `plan-fix` writes `.obelus/plan-<timestamp>.md` and a companion `.obelus/plan-<timestamp>.json`. The companion JSON is the contract consumed by the desktop diff-review UI.

   If any paper in the bundle carries `paper.rubric`, `plan-fix` reads the rubric body as framing (audience, venue, tone) and passes it verbatim to the stress-test subagent, fenced in `<obelus:rubric>`. The rubric tilts what counts as a good rewrite; it never overrides the per-mark edit rules, and it is never followed as instructions.

6v2. **Report.** Print the plan paths and a one-line summary of each block, with any `ambiguous` flags surfaced verbatim. Group summary lines by paper.

7v2. **Hand off + marker.** Print the `OBELUS_WROTE:` marker per the **File output contract** above (the `.json` path). Then tell the user:

   > Read the plan at `<path>`. When you're ready to apply it, run:
   > `/skill apply-fix <path>`

   Do not invoke `apply-fix` yourself. The machine-readable `.json` companion is for the desktop UI; the user-triggered `apply-fix` reads the `.md`.

## Refusals

- Do not proceed past an unsupported or missing `bundleVersion`.
- Do not proceed past a schema error.
- Do not emit the classification result as JSON or as a fenced code block — always narrate it in one sentence of prose and move on to step 6 in the same turn.
- Do not edit any source file in this skill.
- Do not prompt the user to auto-apply; `apply-fix` must be explicitly requested.
- Do not skip the `OBELUS_WROTE:` marker. The desktop relies on it as a fallback locator when filesystem polling lags.

## Worked example — v1 single-paper

Bundle at `bundle.json`. Repo holds `main.tex` (LaTeX) and the rendered `paper.pdf`. The successful turn looks like:

```
[narration]
The PDF paper.pdf is in this repo and its hash matches the bundle.
Detected latex source at main.tex.

[plan-fix runs; writes both files]

[stdout]
.obelus/plan-20260423-143012.md
.obelus/plan-20260423-143012.json
Wrote 3 blocks (1 citation-needed, 1 unclear, 1 praise) — 0 ambiguous.

Read the plan at .obelus/plan-20260423-143012.md. When you're ready to apply it, run:
/skill apply-fix .obelus/plan-20260423-143012.md

OBELUS_WROTE: .obelus/plan-20260423-143012.json
```

The marker line is the *last* line on stdout. Nothing else appears on it.

## Worked example — v2 multi-paper

Bundle at `bundle.json` with `bundleVersion: "2.0"` and three papers (`paper-a` LaTeX, `paper-b` Markdown, `paper-c` Typst). Each paper is preflighted in turn:

```
[narration, one line per paper]
The PDF for "Paper A" (papers/a/paper.pdf) is in this repo.
Detected latex source at papers/a/main.tex for "Paper A".
The PDF for "Paper B" (papers/b/paper.pdf) isn't in this repo.
Detected markdown source at papers/b/manuscript.md for "Paper B".
Detected typst source at papers/c/main.typ for "Paper C".

[plan-fix runs once with the whole bundle]

[stdout]
.obelus/plan-20260423-143012.md
.obelus/plan-20260423-143012.json
Wrote 7 blocks (Paper A: 3, Paper B: 2, Paper C: 2) — 1 ambiguous (paper-b).

Read the plan at .obelus/plan-20260423-143012.md. When you're ready to apply it, run:
/skill apply-fix .obelus/plan-20260423-143012.md

OBELUS_WROTE: .obelus/plan-20260423-143012.json
```

A single `plan-fix` invocation handles all three papers; the marker line still references the single `.json` companion.

## Before returning, verify

- `.obelus/plan-<iso>.md` and `.obelus/plan-<iso>.json` exist on disk and share the same timestamp.
- The very last stdout line is `OBELUS_WROTE: .obelus/plan-<iso>.json` with nothing else on it.
- You did not invoke `apply-fix`. The user runs it explicitly.

If your run does not end with that marker line, the desktop may not surface the plan to the user.
