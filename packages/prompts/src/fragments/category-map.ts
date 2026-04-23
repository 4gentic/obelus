export interface CategoryDestination {
  readonly category: string;
  readonly destination: string;
}

export const CATEGORY_MAP: ReadonlyArray<CategoryDestination> = [
  { category: "`praise`", destination: "Woven into the opening paragraph" },
  { category: "`wrong`", destination: "Major comments" },
  { category: "`weak-argument`", destination: "Major comments" },
  {
    category: "`unclear`",
    destination: "Major comments (default); Minor only for a local-phrasing complaint",
  },
  { category: "`rephrase`", destination: "Minor comments" },
  { category: "`citation-needed`", destination: "Minor comments" },
  {
    category: "`enhancement`",
    destination: "Major comments (forward-looking suggestion — an opportunity, not a defect)",
  },
  {
    category: "`aside`",
    destination: "Minor comments (may be omitted if nothing actionable surfaces)",
  },
  {
    category: "`flag`",
    destination: "Minor comments (may be omitted if nothing actionable surfaces)",
  },
  { category: "*(anything else)*", destination: "Minor comments" },
];

export const CATEGORY_MAP_MARKDOWN: string = [
  "| Category | Destination |",
  "|---|---|",
  ...CATEGORY_MAP.map((row) => `| ${row.category} | ${row.destination} |`),
].join("\n");
