export const palette = {
  paper: "#f6f1e7",
  panel: "#ede5d3",
  ink: "#2b2a26",
  inkSoft: "#6b655a",
  rubric: "#b84a2e",
} as const;

export const highlight = {
  remove: "#9c5550",
  elaborate: "#5e8d6e",
  rephrase: "#6f8ca8",
  improve: "#c99b5a",
  wrong: "#c85a3f",
  weak: "#8a6f9e",
  praise: "#a8b89a",
  note: "#9c8ca3",
  find: "#d9b44a",
} as const;

export const fonts = {
  display: '"Newsreader Variable", "Newsreader", Georgia, serif',
  body: '"Source Serif 4 Variable", "Source Serif 4", Georgia, serif',
  mono: '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace',
} as const;

export const frame = {
  headerHeight: 64,
} as const;

export type PaletteToken = keyof typeof palette;
export type HighlightToken = keyof typeof highlight;
