# LinkedIn launch post

## Headline

Obelus: a review surface for model-written papers.

## Post

When a model drafts the paper, the center of gravity shifts. Writing is cheap. Review is the work — reading closely enough to separate the sentences that happen to be true from the sentences that merely sound like they could be.

Obelus is a tool for that second task. It is a browser-based review surface: open a PDF, highlight passages, categorize each mark (unclear, wrong, weak, needs citation, plagiarism risk), and thread comments where you need them. When you are done, you export a review bundle — one JSON file that records every annotation with enough surrounding context to relocate the passage in source that may have been reflowed, re-hyphenated, or otherwise diverged from the PDF you reviewed.

The bundle is the product seam. In your paper's repository, a Claude Code plugin takes over: `/obelus:apply-review bundle.json` detects whether the source is LaTeX, Markdown, or Typst, plans a minimal-diff fix for each mark, and applies the changes only after you confirm. The web app never sees the plugin. The plugin never sees the web app. They share a single schema.

The review surface itself is offline by construction. PDFs live in the origin-private filesystem; annotations live in IndexedDB. Zero network calls at runtime — no telemetry, no counters, no vendor in the middle of your draft.

MIT-licensed, works offline as a PWA after first load.

obelus.app
