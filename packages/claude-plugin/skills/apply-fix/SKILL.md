---
name: apply-fix
description: Apply an approved Obelus plan file to the paper source.
argument-hint: <plan-path>
disable-model-invocation: true
allowed-tools: Read Edit Write
---

# Apply fix

Execute an already-written plan file. The user must invoke this skill by name.

## Path scope

Every `file` in the plan must resolve to a location inside the current paper-repo root (the working directory in which this skill is invoked). That is the only tree this skill is authorized to write to.

A target path is admissible iff **all** of the following hold:

- it is **not** absolute (no leading `/`, no `C:` / `D:` / etc. drive prefix),
- it contains **no** `..` segment,
- it uses POSIX separators (no `\`),
- after resolving against the repo root, the normalized path is still under the repo root (no symlink or canonicalization escape).

If any `file` fails those checks, skip the block and record it as `refused (out of scope)`. Do not call Edit or Write for it.

## Steps

0. **Verify target paths.** Before any Read/Edit/Write, walk the parsed blocks and check every `file` against the **Path scope** rules above. A single refused block does not abort the run — skip it and continue — but an Edit/Write tool call for a refused path is a bug, never execute one.

1. Read the plan at `<plan-path>`. Parse each `##` block into `{ file, startLine, endLine, before, after, ambiguous }`.

2. For each block, in order:
   - If the block's `file` failed step 0, skip. Record as refused.
   - If `ambiguous: true`, skip. Record as skipped.
   - If `edit: none` (e.g. `praise` blocks), skip. Record as recorded.
   - Otherwise, read the target file, confirm the `before` text still matches at the recorded span (source may have changed since the plan was written), and apply it with the Edit tool. If `before` no longer matches, skip and record as stale.

3. Do not batch edits. One block, one Edit call. If a block fails to apply, record the reason and continue to the next.

4. Write a summary to `.obelus/apply-<iso-timestamp>.md`:
   - `Applied: <n>` — list with file:line
   - `Refused (out of scope): <n>`
   - `Skipped (ambiguous): <n>`
   - `Skipped (stale): <n>`
   - `Recorded (praise / no-op): <n>`

   The summary path `.obelus/apply-<iso-timestamp>.md` is itself inside the repo root, which is why it is safe to Write.

5. Print the summary counts to the user and the summary path.

## Refusals

- Do not edit any file outside the ones named in the plan.
- Do not edit any file that violates the **Path scope** rules, even if named in the plan.
- Do not rewrite a block the planner flagged `ambiguous`.
- Do not re-plan. If a block is stale, surface it; the user can re-run `apply-revision`.
