---
name: apply-fix
description: Apply an approved Obelus plan file to the paper source.
argument-hint: <plan-path> [--dry-run]
disable-model-invocation: true
allowed-tools: Read Edit Write
---

# Apply fix

Read an already-written Obelus plan file and apply each block as a single-hunk edit on the paper source, then write a summary file under `.obelus/`. The user must invoke this skill by name.

## Arguments

- `<plan-path>` — path to the `.obelus/plan-<iso>.md` produced by `apply-revision` / `plan-fix`.
- `--dry-run` (optional, default off) — print the patches that *would* be applied, write the summary file, but do not call `Edit` on any source. Useful before a destructive run on a dirty working tree.

## Path scope

Every `file` in the plan must resolve to a location inside the current paper-repo root (the working directory in which this skill is invoked). That is the only tree this skill is authorized to write to.

A target path is admissible iff **all** of the following hold:

- it is **not** absolute (no leading `/`, no `C:` / `D:` / etc. drive prefix),
- it contains **no** `..` segment,
- it uses POSIX separators (no `\`),
- after resolving against the repo root, the normalized path is still under the repo root (no symlink or canonicalization escape).

If any `file` fails those checks, skip the block and record it as `refused (out of scope)`. Do not call Edit or Write for it.

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

4. Write a summary to `.obelus/apply-<iso-timestamp>.md` (compact UTC: `YYYYMMDD-HHmmss`, e.g. `20260423-143012`):
   - `Mode: applied` or `Mode: dry-run`
   - `Applied: <n>` — list with `file:line` and the annotation id
   - `Refused (out of scope): <n>` — list with annotation id and the offending path, parenthetical reason
   - `Skipped (ambiguous): <n>` — list with annotation id
   - `Skipped (stale): <n>` — list with annotation id and the file:line we read
   - `Recorded (praise / no-op): <n>` — list with annotation id

   The summary path `.obelus/apply-<iso-timestamp>.md` is itself inside the repo root, which is why it is safe to Write.

5. **Final marker line.** Print the summary counts to the user, then print exactly one line on stdout in this form, with nothing else on the line:

   ```
   OBELUS_WROTE: .obelus/apply-<iso-timestamp>.md
   ```

   This is the same marker convention `apply-revision` and `write-review` use; the desktop scans stdout for it as a fallback locator.

## Refusals

- Do not edit any file outside the ones named in the plan.
- Do not edit any file that violates the **Path scope** rules, even if named in the plan. Surface the refusal by name in the summary; do not silently drop it.
- Do not rewrite a block the planner flagged `ambiguous`.
- Do not re-plan. If a block is stale, surface it; the user can re-run `apply-revision`.
- Do not skip the `OBELUS_WROTE:` marker.

## Worked example — dry run

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

## Before returning, verify

- Every block in the plan was either applied, refused, skipped, or recorded — none silently dropped.
- The `.obelus/apply-<iso>.md` summary exists on disk.
- The very last stdout line is `OBELUS_WROTE: .obelus/apply-<iso>.md` with nothing else on it.
