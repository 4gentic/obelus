---
description: Triage a GitHub issue, collect fields with high fidelity, preview the body, and file via gh. Interactive.
argument-hint: "[--dry-run]  # preview only; do not submit"
allowed-tools: AskUserQuestion, Bash, Read, Write
---

# /new-issue

One command. Five templates. A filed issue that another agent can act on.

This command is the only supported way to file a quality issue against Obelus from a Claude Code session. It triages the request, picks the right YAML form under `.github/ISSUE_TEMPLATE/`, walks the user through every required field in conversation, previews the rendered Markdown body, and submits with `gh issue create`. The goal is that the issue body, without any follow-up, contains enough detail that a fresh agent can start reading code.

## Execution plan

Follow these steps top to bottom. Do not skip step 1.

### 1. Precheck

Run, in order:

```
gh auth status
gh repo view --json nameWithOwner
```

- If `gh auth status` fails, print the exact login command (`gh auth login --hostname github.com --web`) and stop. Do not attempt interactive auth from inside the session.
- Surface the resolved `nameWithOwner` (e.g. `4gentic/obelus`) to the user — the command files against whichever repo `gh` is pointed at, and the user deserves to see it.

Also capture the label list once for later:

```
gh label list --json name -q '.[].name'
```

### 2. Triage

One `AskUserQuestion` call, one question, five options. Category only.

| Option | Template | Labels |
|---|---|---|
| Bug | `bug_report.yml` | `bug` |
| Regression | `regression.yml` | `bug`, `regression` |
| Feature | `feature_request.yml` | `enhancement` |
| Documentation | `documentation.yml`/`docs.yml` | `documentation` |
| Performance | `performance.yml` | `performance` |

If the user picks "Other" and describes something that maps to one of the five, confirm the mapping in one sentence and proceed. If it truly does not fit, suggest they open a Discussion instead and stop.

### 3. Load the template

`Read` the corresponding file in `.github/ISSUE_TEMPLATE/`. Parse its `body:` list. For each element:

- `type: markdown` — display to the user as context (do not collect a value).
- `type: checkboxes` — walk each option; ask the user to confirm required boxes.
- `type: input`, `type: textarea` — collect one value.
- `type: dropdown` — if it materially gates downstream questions (e.g. the bug form's `surface` skips the browser field when desktop), use a second `AskUserQuestion`. Otherwise collect inline.

Respect `validations.required`. Required fields cannot be skipped.

Cap total `AskUserQuestion` calls at three: triage, plus at most two follow-ups for branching dropdowns. Everything else is a conversational turn — not a wizard.

### 4. Field collection

Walk required fields in template order, then optional ones. For each field:

1. Ask in plain voice, referencing the template's `label` and `description`.
2. Quote the user's answer back in a blockquote.
3. Offer `keep / edit / skip` (skip only offered when optional).

Special handling:

- **Log and stack-trace fields** (the ones with `render: shell`): explicitly say *"paste verbatim, don't truncate with `…`"* before you ask. These fields are the exception to the "don't paste code" rule — logs must be untouched.
- **Grep anchors** (bug, regression, performance): explicitly solicit symbols and paths, not source. If the user pastes a function body, intervene (see step 5).
- **Empty-but-valuable optionals**: if the user skips the `grep anchors` or `logs` field on a bug, note once that the issue will be harder for a fixing agent to act on, then continue.

### 5. Anti-code-paste guardrail

If the user's answer to any field other than `logs` / `stack trace` contains a fenced code block longer than roughly thirty lines, intervene exactly once:

> That looks like a code dump. For the `grep anchors` field, a function name and a file path serves the next agent better than the current implementation. Want to trim to the symbol + path, or keep it as-is?

Do not reject the answer. Offer the trim. Respect the user's final call.

### 6. Preview

Render the full Markdown body with section headers matching the form's field labels. Include every field the user provided a value for (skip empty optionals). Render `render: shell` fields inside a fenced ```` ``` ```` block.

Print in a fenced ```` ```markdown ```` block. Immediately after, print the resolved `gh issue create` invocation in a second fenced block — title, labels, and `--repo` — so the user sees exactly what is about to run.

Ask the user: `Submit? [y/N/edit <field>]`.

- `y` — step 7.
- `N` or empty — abort; do not submit.
- `edit <field>` — re-ask that field, re-render, ask again.

### 7. Label pre-flight and submit

Intersect the template's labels with the list captured in step 1. For any missing label, print:

```
note: label "<name>" not found on <repo>; filing without it
```

Do not auto-create labels. Label creation needs admin scope, and silently minting labels masks honest routing mistakes. If `regression`, `performance`, or `area:*` labels are missing, the one-time setup steps in `CONTRIBUTING.md` will apply them.

Write the body to a temp file (avoids HEREDOC escape issues):

```
tmp=$(mktemp -t obelus-issue) && cat > "$tmp" <<'BODY'
<rendered body>
BODY
gh issue create --title "<summary>" --body-file "$tmp" --label "<comma-separated existing labels>"
```

Print the returned URL, plus a one-line summary:

```
Filed <repo>#<number> — <summary>
<url>
```

### 8. --dry-run

If the user passed `--dry-run`, stop after step 6. Do not call `gh issue create`. Print the preview and the resolved `gh` command only. This is the safe path for testing the command itself or showing a colleague what it would submit.

## Conventions the rendered body must honor

- Section headers match the template's field labels, in template order. No re-ordering.
- Optional fields with no value are omitted entirely — no empty `### Stack trace` section.
- Preserve user formatting inside textareas (numbered lists, code blocks, links). Do not rewrap.
- Do not add a trailing signature, "filed via /new-issue" footer, or any marker. The issue should read as if the user wrote it by hand.

## Voice

- Declarative. Periods. No exclamations.
- Do not editorialize in the body. Do not add commentary like "the user also mentioned…".
- Match the Obelus voice: terse, concrete, serif-honest.

## Why this command exists

Writing a good issue is half the fix. The fields on the YAML forms (version, surface, logs, grep anchors) are exactly the inputs a fixing agent needs to start reading code. The command's job is to make it harder to file an empty issue than a useful one.
