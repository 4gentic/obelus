import type { Category } from "@obelus/bundle-schema";

export type { Category };

export type CategoryMeta = {
  readonly id: Category;
  readonly label: string;
  readonly tokenVar: string;
  readonly description: string;
};

export const DEFAULT_CATEGORIES: ReadonlyArray<CategoryMeta> = [
  {
    id: "unclear",
    label: "unclear",
    tokenVar: "--hl-unclear",
    description: "The reader can't parse what's meant. Rewrite so the claim lands.",
  },
  {
    id: "wrong",
    label: "wrong",
    tokenVar: "--hl-wrong",
    description: "A factual, logical, or empirical error.",
  },
  {
    id: "weak-argument",
    label: "weak argument",
    tokenVar: "--hl-weak",
    description: "The reasoning or evidence is thin — the claim is not yet earned.",
  },
  {
    id: "citation-needed",
    label: "citation needed",
    tokenVar: "--hl-cite",
    description: "A reference is missing or bare.",
  },
  {
    id: "rephrase",
    label: "rephrase",
    tokenVar: "--hl-rephrase",
    description: "Phrasing could be smoother. No substantive issue.",
  },
  {
    id: "praise",
    label: "praise",
    tokenVar: "--hl-praise",
    description: "A strength worth naming in the letter's opening.",
  },
  {
    id: "enhancement",
    label: "enhancement",
    tokenVar: "--hl-enhancement",
    description:
      "A forward-looking suggestion to strengthen this passage — not a defect, an opportunity.",
  },
  {
    id: "aside",
    label: "aside",
    tokenVar: "--hl-aside",
    description:
      "Side remark or context. The AI may fold it into the letter, question you about it, or leave it alone.",
  },
  {
    id: "flag",
    label: "flag",
    tokenVar: "--hl-flag",
    description: "Pay attention here. A pointer for the AI — it may act on it or do nothing.",
  },
];

export function descriptionFor(id: string): string | undefined {
  return DEFAULT_CATEGORIES.find((c) => c.id === id)?.description;
}
