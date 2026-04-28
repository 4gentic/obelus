export type Category =
  | "remove"
  | "elaborate"
  | "rephrase"
  | "improve"
  | "wrong"
  | "weak-argument"
  | "praise"
  | "note";

export type CategoryMeta = {
  readonly id: Category;
  readonly label: string;
  readonly tokenVar: string;
  readonly description: string;
};

export const DEFAULT_CATEGORIES: ReadonlyArray<CategoryMeta> = [
  {
    id: "remove",
    label: "remove",
    tokenVar: "--hl-remove",
    description:
      "Cut this passage. The AI must verify removal doesn't leave dangling references or broken transitions in the surrounding text.",
  },
  {
    id: "elaborate",
    label: "elaborate",
    tokenVar: "--hl-elaborate",
    description: "Say more. The reader needs additional detail or unpacking here.",
  },
  {
    id: "rephrase",
    label: "rephrase",
    tokenVar: "--hl-rephrase",
    description: "Reshape the wording. The meaning is fine; the prose isn't.",
  },
  {
    id: "improve",
    label: "improve",
    tokenVar: "--hl-improve",
    description:
      "A forward-looking opportunity to strengthen this passage — not a defect, an opportunity.",
  },
  {
    id: "wrong",
    label: "wrong",
    tokenVar: "--hl-wrong",
    description: "A factual, logical, or empirical error. Correct it or contest it.",
  },
  {
    id: "weak-argument",
    label: "weak argument",
    tokenVar: "--hl-weak",
    description: "The reasoning or evidence is thin. The claim is not yet earned.",
  },
  {
    id: "praise",
    label: "praise",
    tokenVar: "--hl-praise",
    description: "A strength worth naming in the cover letter's opening.",
  },
  {
    id: "note",
    label: "note",
    tokenVar: "--hl-note",
    description: "A neutral pointer for the AI. It may act on it or leave it alone.",
  },
];

export function descriptionFor(id: string): string | undefined {
  return DEFAULT_CATEGORIES.find((c) => c.id === id)?.description;
}
