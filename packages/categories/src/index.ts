import type { Category } from "@obelus/bundle-schema";

export type { Category };

export type CategoryMeta = {
  readonly id: Category;
  readonly label: string;
  readonly tokenVar: string;
};

export const DEFAULT_CATEGORIES: ReadonlyArray<CategoryMeta> = [
  { id: "unclear", label: "unclear", tokenVar: "--hl-unclear" },
  { id: "wrong", label: "wrong", tokenVar: "--hl-wrong" },
  { id: "weak-argument", label: "weak argument", tokenVar: "--hl-weak" },
  { id: "citation-needed", label: "citation needed", tokenVar: "--hl-cite" },
  { id: "rephrase", label: "rephrase", tokenVar: "--hl-rephrase" },
  { id: "praise", label: "praise", tokenVar: "--hl-praise" },
];
