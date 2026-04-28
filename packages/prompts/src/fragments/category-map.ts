export interface CategoryDestination {
  readonly category: string;
  readonly destination: string;
}

export const CATEGORY_MAP: ReadonlyArray<CategoryDestination> = [
  { category: "`praise`", destination: "Woven into the opening paragraph" },
  { category: "`wrong`", destination: "Major comments" },
  { category: "`weak-argument`", destination: "Major comments" },
  {
    category: "`remove`",
    destination:
      "Major comments — name what's being cut and verify the surrounding text still reads coherently after removal",
  },
  {
    category: "`improve`",
    destination: "Major comments (forward-looking opportunity, not a defect)",
  },
  {
    category: "`elaborate`",
    destination: "Major comments — surface what the reader still needs and write the addition",
  },
  { category: "`rephrase`", destination: "Minor comments" },
  {
    category: "`note`",
    destination: "Minor comments (may be omitted if nothing actionable surfaces)",
  },
  { category: "*(anything else)*", destination: "Minor comments" },
];

export const CATEGORY_MAP_MARKDOWN: string = [
  "| Category | Destination |",
  "|---|---|",
  ...CATEGORY_MAP.map((row) => `| ${row.category} | ${row.destination} |`),
].join("\n");
