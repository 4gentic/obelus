export const palette = {
  paper: "#f6f1e7",
  panel: "#ede5d3",
  ink: "#2b2a26",
  inkSoft: "#6b655a",
  rubric: "#b84a2e",
} as const;

export const highlight = {
  unclear: "#d9b44a",
  wrong: "#c85a3f",
  weak: "#8a6f9e",
  cite: "#5e8d6e",
  praise: "#a8b89a",
  rephrase: "#6f8ca8",
  enhancement: "#c99b5a",
  aside: "#9c8ca3",
  flag: "#6b8b8a",
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
