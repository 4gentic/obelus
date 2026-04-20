---
name: detect-format
description: Detect the paper's source format in this repo and emit a format descriptor.
allowed-tools: Read Glob Grep
---

# Detect format

Walk the repo and classify its paper source. Emit a single descriptor:

```
{ format: "latex" | "markdown" | "typst" | "unknown", entrypoint: string, sourceFiles: string[] }
```

## Procedure

1. **LaTeX.** Glob `**/*.tex`. For each, read the first ~200 lines and look for `\documentclass`. The root is the file that has it (not `\input`'d from elsewhere). If multiple candidates exist, prefer `main.tex`, `paper.tex`, then the shortest path. `sourceFiles` is every `.tex` (including those reachable via `\input` / `\include`).

2. **Typst.** Glob `**/*.typ`. Entrypoint heuristic: presence of `#set document(` or `#show:` at top level. Prefer `main.typ`, `paper.typ`, `report.typ`.

3. **Markdown.** Glob `**/*.md` excluding `README.md`, `CHANGELOG.md`, `LICENSE.md`, `CONTRIBUTING.md`, and anything under `node_modules/`, `.git/`, `dist/`, `build/`. A Markdown paper usually has a YAML frontmatter block (`---` at line 1) with `title:` or `author:`. Prefer `paper.md`, `manuscript.md`, then the longest remaining `.md` by word count.

4. **Conflict resolution.** If two formats both present candidates, pick the one whose entrypoint was modified most recently. Record the other in a `notes` field.

5. **Unknown.** If nothing matches, set `format: "unknown"`, `entrypoint: ""`, `sourceFiles: []`.

## Output

Print **only** the descriptor as fenced JSON. Do not emit prose, preamble, or notes outside the JSON envelope — the descriptor's `notes` field is the only place for disambiguation commentary. The caller (`apply-marks`) parses the fenced JSON block and narrates the result to the user; this skill never addresses the user directly.
