# Capture fixtures

Markdown papers the metrics-capture harness (`scripts/capture-metrics.mjs`)
anchors synthetic review marks against. These exist so a telemetry capture is
reproducible without a reviewer's real paper on disk.

- `large.md` — a multi-section systems paper (~25 reviewable prose spans)
  used by `--fixture large`. Long enough to support the top of the capture
  gradient (25 marks) with one distinct, defensible mark per span.

The harness's built-in `small` fixture is the shared
`packages/claude-plugin/fixtures/sample/sample.md` paper; it carries fewer
spans and is the right size for 1–7 mark captures.

Marks are synthesised with **source anchors** (`anchor.kind === "source"`),
so the plugin jumps straight to a file line rather than fuzzy-matching a PDF
quote. That keeps the synthesis deterministic: a given `(fixture, N)` always
produces the same bundle. See the script's header comment for the full
rationale.
