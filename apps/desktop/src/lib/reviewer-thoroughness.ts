export type ReviewerThoroughness = "normal" | "deep";

export interface ThoroughnessSpawn {
  model: "sonnet" | "opus";
  effort: "low" | "high";
}

export const THOROUGHNESS_SPAWN: Record<ReviewerThoroughness, ThoroughnessSpawn> = {
  normal: { model: "sonnet", effort: "low" },
  deep: { model: "opus", effort: "high" },
};

export interface ThoroughnessCopy {
  label: string;
  modelLabel: string;
  blurb: string;
}

export const THOROUGHNESS_COPY: Record<ReviewerThoroughness, ThoroughnessCopy> = {
  normal: {
    label: "Normal",
    modelLabel: "Sonnet 4.6 · low effort",
    blurb: "Faster turnaround. The default for routine reviews.",
  },
  deep: {
    label: "Deep thinking",
    modelLabel: "Opus 4.7 · high effort",
    blurb: "Slower, more thorough. Equal or better results on complex reviews.",
  },
};

export const DEFAULT_THOROUGHNESS: ReviewerThoroughness = "normal";
