export const EDIT_SHAPE_MARKDOWN: string = [
  "- `remove` — delete the passage. Check no surrounding sentence references it; smooth any transition that becomes abrupt.",
  "- `elaborate` — add the missing detail or unpacking. Any new claim you introduce must carry a format-appropriate `TODO` citation placeholder: `\\cite{TODO}` (LaTeX), `[@TODO]` (Markdown), `#emph[(citation needed)]` (Typst), `<cite>(citation needed)</cite>` (HTML). Do not invent references, and do not emit `@TODO` or `#cite(TODO)` in Typst — both resolve to bibliography keys and fail to compile when no matching entry exists.",
  "- `rephrase` — reshape the sentence without changing its claim.",
  "- `improve` — strengthen this passage. If the strengthening introduces a new claim, carry the same TODO-citation placeholder rules as `elaborate`.",
  "- `wrong` — propose a correction. If uncertain, skip and flag.",
  "- `weak-argument` — tighten the argument; any new claim you add carries the same TODO-citation placeholder rules as `elaborate`.",
  "- `praise` — no edit; leave the line intact.",
  "- `note` — no required edit; act only if a clear, low-risk change surfaces; otherwise leave intact.",
].join("\n");
