export const EDIT_SHAPE_MARKDOWN: string = [
  "- `unclear` — rewrite for clarity; preserve every factual claim.",
  "- `wrong` — propose a correction. If uncertain, skip and flag.",
  "- `weak-argument` — tighten the argument; any new claim you add must carry a `TODO` citation placeholder (same format-specific forms as `citation-needed` below).",
  "- `citation-needed` — insert a format-appropriate **compilable** placeholder: `\\cite{TODO}` in LaTeX, `[@TODO]` in Markdown, `#emph[(citation needed)]` in Typst, `<cite>(citation needed)</cite>` in HTML. Do not invent references, and do not emit `@TODO` or `#cite(TODO)` in Typst — both forms resolve to a bibliography key and fail to compile when no matching entry exists. In HTML, do not invent an `<a href>` target; `<cite>` keeps the placeholder semantic and the user can swap it for a proper reference later.",
  "- `rephrase` — reshape the sentence without changing its claim.",
  "- `praise` — no edit; leave the line intact.",
].join("\n");
