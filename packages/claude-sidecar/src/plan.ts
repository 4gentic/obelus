import { z } from "zod";

export const PlanBlock = z.object({
  annotationId: z.string(),
  file: z.string(),
  category: z.string(),
  patch: z.string(),
  ambiguous: z.boolean(),
  reviewerNotes: z.string(),
});

export const PlanFile = z.object({
  bundleId: z.string(),
  blocks: z.array(PlanBlock),
});

export type PlanBlock = z.infer<typeof PlanBlock>;
export type PlanFile = z.infer<typeof PlanFile>;

export function pickLatestPlanName(names: ReadonlyArray<string>): string | null {
  const candidates = names.filter((n) => /^plan-.*\.json$/.test(n));
  if (candidates.length === 0) return null;
  return [...candidates].sort().at(-1) ?? null;
}
