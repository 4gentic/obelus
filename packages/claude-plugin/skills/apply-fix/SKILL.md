---
name: apply-fix
description: Apply an approved Obelus plan file to the paper source.
argument-hint: <plan-path> [--dry-run]
disable-model-invocation: true
allowed-tools: Read Edit Write Bash
---

# Apply fix

Read an already-written Obelus plan file and apply each block as a single-hunk edit on the paper source, then write a summary file under the resolved workspace prefix. The user must invoke this skill by name.

## Workspace resolution — read this first

The **workspace prefix** is `${OBELUS_WORKSPACE_DIR:-.obelus}`: when `$OBELUS_WORKSPACE_DIR` is set (Obelus desktop spawns Claude Code with it set to an absolute path under app-data), use that absolute directory; otherwise fall back to `.obelus/` relative to the current working directory.

## Arguments

- `<plan-path>` — path to the plan markdown produced by `apply-revision` / `plan-fix`. Under Obelus desktop this is an absolute path under `$OBELUS_WORKSPACE_DIR`; in standalone mode it is `.obelus/plan-<iso>.md`.
- `--dry-run` (optional, default off) — print the patches that *would* be applied, write the summary file, but do not call `Edit` on any source. Useful before a destructive run on a dirty working tree.

## Path scope

Every `file` in a plan **block** must resolve to a location inside the current paper-repo root (the working directory in which this skill is invoked). That is the only tree this skill is authorized to apply edits in.

A block target path is admissible iff **all** of the following hold:

- it is **not** absolute (no leading `/`, no `C:` / `D:` / etc. drive prefix),
- it contains **no** `..` segment,
- it uses POSIX separators (no `\`),
- after resolving against the repo root, the normalized path is still under the repo root (no symlink or canonicalization escape).

If any block `file` fails those checks, skip the block and record it as `refused (out of scope)`. Do not call Edit or Write for it.

### Workspace artifacts (skill-internal writes)

The artifacts this skill itself writes — the apply summary `apply-<iso>.md` and (for Typst) the rendered preview `rendered/<entrypoint-basename>.pdf` — land under the workspace prefix, which under Obelus is **outside** the repo root by design. The Path scope rules above apply to plan-block targets (paper source), not to these workspace artifacts. Writing to `${OBELUS_WORKSPACE_DIR:-.obelus}/apply-<iso>.md` and `${OBELUS_WORKSPACE_DIR:-.obelus}/rendered/<file>.pdf` is allowed and required.

### Scope-check refusal example

A plan block that names `file: ../../etc/hosts` resolves outside the repo root. The block is skipped, and the summary records:

```
Refused (out of scope): 1
  - 550e8400-...-446655440003 → ../../etc/hosts (escapes repo root)
```

The user sees the named path in the summary so they can audit the bundle that produced it. Do **not** silently drop it.

## Steps

0. **Verify target paths.** Before any Read/Edit/Write, walk the parsed blocks and check every `file` against the **Path scope** rules above. A single refused block does not abort the run — skip it and continue — but an Edit/Write tool call for a refused path is a bug, never execute one.

1. Read the plan at `<plan-path>`. Parse each `##` block into `{ annotationId, file, startLine, endLine, before, after, ambiguous }`.

2. For each block, in order:
   - If the block's `file` failed step 0, skip. Record as refused.
   - If `ambiguous: true`, skip. Record as skipped.
   - If `edit: none` (e.g. `praise` blocks), skip. Record as recorded.
   - If `--dry-run` was passed, print the would-be patch (`@@ -L,N +L,N @@` plus the `- before` / `+ after` lines) and continue without calling `Edit`.
   - Otherwise, read the target file, confirm the `before` text still matches at the recorded span (source may have changed since the plan was written), and apply it with the Edit tool. If `before` no longer matches, skip and record as stale.

3. Do not batch edits. One block, one Edit call. If a block fails to apply, record the reason and continue to the next.

4. **Compile verify (Typst only).** Skip this step entirely on `--dry-run`. Otherwise, open the companion `plan-<iso>.json` next to the `.md` plan and read its top-level `format` and `entrypoint` fields. If `format === "typst"`, `entrypoint !== ""`, and at least one block was applied in step 2, run:

   ```
   typst compile <entrypoint> ${OBELUS_WORKSPACE_DIR:-.obelus}/rendered/<entrypoint-basename>.pdf --root .
   ```

   via `Bash`. First check `typst --version` — if that command fails (non-zero exit or "command not found"), skip compile verify entirely and record `Compile verify: skipped (typst not on PATH)` in the summary. Do not treat typst's absence as an apply failure; the edits still stand.

   On non-zero exit from `typst compile`, parse **the first 5 errors** from stderr. The Typst error format is `<file>:<line>:<col>: error: <message>`, sometimes followed by source context lines and a caret — ignore anything after the `error:` line until you reach the next `<file>:<line>:<col>:` header. For each error, Read the affected file around the line, propose a minimal Edit that resolves it (typical cases: a `@key` or `#cite(<key>)` referencing a missing bib entry → rewrite to `#emph[(citation needed)]`; unbalanced braces → restore them; unknown identifier → restore the name from the `before` side of the plan block that introduced it). Then rerun `typst compile` exactly as above.

   **Retry cap: 2.** After the second failed retry, stop attempting fixes and move on to step 5. Record unresolved errors in the summary as `Compile errors (unresolved)` — do NOT revert earlier edits; the bytes are valid, only the compile is broken, and the user should see what landed.

5. Write a summary to `${OBELUS_WORKSPACE_DIR:-.obelus}/apply-<iso-timestamp>.md` (compact UTC: `YYYYMMDD-HHmmss`, e.g. `20260423-143012`):
   - `Mode: applied` or `Mode: dry-run`
   - `Applied: <n>` — list with `file:line` and the annotation id
   - `Refused (out of scope): <n>` — list with annotation id and the offending path, parenthetical reason
   - `Skipped (ambiguous): <n>` — list with annotation id
   - `Skipped (stale): <n>` — list with annotation id and the file:line we read
   - `Recorded (praise / no-op): <n>` — list with annotation id
   - `Compile fixes applied: <n>` — list with `file:line — before → after` per follow-up Edit from step 4. Emit even when zero — `Compile fixes applied: 0` is a fact.
   - `Compile errors (unresolved): <n>` — list with `file:line — message` per error left after the retry cap. Omit the section entirely when zero (distinct from "we didn't run" — which prints as the `Compile verify: skipped (…)` line under `Mode:`).

   The summary path is a workspace artifact (see the Workspace artifacts clause above), which is why it is safe to Write.

6. **Final marker line.** Print the summary counts to the user, then print exactly one line on stdout in this form, with nothing else on the line:

   ```
   OBELUS_WROTE: ${OBELUS_WORKSPACE_DIR:-.obelus}/apply-<iso-timestamp>.md
   ```

   When `$OBELUS_WORKSPACE_DIR` is set, this is an absolute path; in standalone mode it is `.obelus/apply-<iso-timestamp>.md`. Same convention `apply-revision` and `write-review` use; the desktop scans stdout for it as a fallback locator.

## Refusals

- Do not edit any file outside the ones named in the plan.
- Do not edit any file that violates the **Path scope** rules, even if named in the plan. Surface the refusal by name in the summary; do not silently drop it.
- Do not rewrite a block the planner flagged `ambiguous`.
- Do not re-plan. If a block is stale, surface it; the user can re-run `apply-revision`.
- Do not skip the `OBELUS_WROTE:` marker.
- Do not revert applied edits because compile verify failed. The bytes are valid; record the unresolved compile errors in the summary and let the user decide.
- Do not run `typst compile` if `typst --version` fails — record `Compile verify: skipped (typst not on PATH)` and return normally.
- Do not retry `typst compile` more than twice. Two attempts cap cascading self-edits; beyond that, report rather than fix.

## Worked example — dry run (standalone fallback, `$OBELUS_WORKSPACE_DIR` unset)

Plan at `.obelus/plan-20260423-143012.md` with three blocks (one valid, one out-of-scope, one praise). With `--dry-run`:

```
[stdout]
Would apply (1):
  main.tex:142 — citation-needed (550e8400-...-440001)
  @@ -142,1 +142,1 @@
  - as shown by Vaswani et al.
  + as shown by Vaswani et al.~\cite{TODO}

Refused (1):
  ../../etc/hosts — escapes repo root (550e8400-...-440003)

Recorded (1):
  conclusion.tex:88 — praise (550e8400-...-440002)

OBELUS_WROTE: .obelus/apply-20260423-143012.md
```

No `Edit` tool calls happened. The summary file describes the planned actions so the user can review before rerunning without `--dry-run`.

## Worked example — Typst compile verify (Obelus desktop spawn, `$OBELUS_WORKSPACE_DIR` set to `/Users/juan/Library/Application Support/app.obelus.desktop/projects/abcd-1234`)

Plan's companion JSON sets `format: "typst"`, `entrypoint: "main.typ"`. Step 2 applies one `citation-needed` edit at `main.typ:42`, inserting a stale `@smith` cite that no `.bib` entry defines. The plan itself was valid; the source tree shifted under it (a reviewer renamed the bib key after the plan was written). Step 4 runs:

```
$ typst --version
typst 0.12.0
$ typst compile main.typ "/Users/juan/Library/Application Support/app.obelus.desktop/projects/abcd-1234/rendered/main.pdf" --root .
error: label `<smith>` does not exist in the document
   ┌─ main.typ:42:31
```

The skill Reads `main.typ:40-44`, confirms `@smith` on line 42 is the offending token, and issues an Edit replacing `@smith` with `#emph[(citation needed)]`. Rerun:

```
$ typst compile main.typ "/Users/juan/Library/Application Support/app.obelus.desktop/projects/abcd-1234/rendered/main.pdf" --root .
$ echo $?
0
```

Summary:

```md
Mode: applied
Applied: 1
  main.typ:42 — citation-needed (550e8400-...-440042)
Refused (out of scope): 0
Skipped (ambiguous): 0
Skipped (stale): 0
Recorded (praise / no-op): 0
Compile fixes applied: 1
  main.typ:42 — @smith → #emph[(citation needed)]
```

Then the marker (absolute because `$OBELUS_WORKSPACE_DIR` is set; in standalone mode it would read `OBELUS_WROTE: .obelus/apply-20260423-143012.md`):

```
OBELUS_WROTE: /Users/juan/Library/Application Support/app.obelus.desktop/projects/abcd-1234/apply-20260423-143012.md
```

If the second retry had also failed, the summary would instead carry:

```md
Compile fixes applied: 2
  main.typ:42 — @smith → #emph[(citation needed)]
  main.typ:42 — #emph[(citation needed)] → #emph((citation needed))
Compile errors (unresolved): 1
  main.typ:42 — expected content, found closing paren
```

and `apply-fix` still prints its `OBELUS_WROTE:` marker. The user sees what landed, what was tried, and what is still broken.

## Before returning, verify

- Every block in the plan was either applied, refused, skipped, or recorded — none silently dropped.
- The `${OBELUS_WORKSPACE_DIR:-.obelus}/apply-<iso>.md` summary exists on disk.
- If `format === "typst"`, the summary contains either a `Compile fixes applied: <n>` line (runs that attempted compile verify) or a `Compile verify: skipped (…)` line (typst-not-on-PATH path). Never both.
- The very last stdout line is `OBELUS_WROTE: ${OBELUS_WORKSPACE_DIR:-.obelus}/apply-<iso>.md` with nothing else on it.
