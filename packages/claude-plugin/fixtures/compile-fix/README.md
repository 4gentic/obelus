# compile-fix fixtures

Two deliberately-broken paper sources plus their paired compile-error bundles,
for exercising the `fix-compile` skill end-to-end (plugin e2e harness, manual
spot-checks, future unit tests).

- `broken-typst.typ` + `typst-error.bundle.json` — Typst reports an unknown
  identifier `#fo` at line 5. The skill should propose a compilable placeholder
  and the post-apply `typst compile` should exit 0.
- `broken-latex.tex` + `latex-error.bundle.json` — `latexmk` reports an
  undefined control sequence `\undefinedcmd` at line 8. The skill should
  replace the bad token with a compilable TODO and the post-apply
  `latexmk`/`tectonic` should exit 0.

Each bundle validates against
`packages/bundle-schema/schemas/compile-error.schema.json`. Run the skill with:

```sh
claude -p --plugin-dir packages/claude-plugin \
  /obelus:fix-compile packages/claude-plugin/fixtures/compile-fix/typst-error.bundle.json
```

The skill edits the broken source file in place (`broken-typst.typ` or
`broken-latex.tex`) and stops. No plan file is written under `.obelus/`, and
no `OBELUS_WROTE:` marker is emitted — Claude prints a one-paragraph summary
on stdout. Re-run the compiler (`typst compile`, `latexmk`, etc.) manually to
verify the fix landed.
