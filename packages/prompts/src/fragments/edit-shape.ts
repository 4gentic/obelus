export const EDIT_SHAPE_MARKDOWN: string = [
  "- `unclear` — rewrite for clarity; preserve every factual claim.",
  "- `wrong` — propose a correction. If uncertain, skip and flag.",
  "- `weak-argument` — tighten the argument; any new claim you add must carry a `TODO` citation placeholder.",
  "- `citation-needed` — insert a format-appropriate placeholder: `\\cite{TODO}` in LaTeX, `[@TODO]` in Markdown, `@TODO` in Typst. Do not invent references.",
  "- `rephrase` — reshape the sentence without changing its claim.",
  "- `praise` — no edit; leave the line intact.",
].join("\n");
