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
  // Primary: timestamped `plan-<iso>.json` (the contract). Secondary: bare
  // `plan.json` for the case where a smaller model drops the timestamp segment.
  const timestamped = names.filter((n) => /^plan-.+\.json$/.test(n));
  if (timestamped.length > 0) return [...timestamped].sort().at(-1) ?? null;
  if (names.includes("plan.json")) return "plan.json";
  return null;
}

export function pickLatestWriteupName(
  names: ReadonlyArray<string>,
  paperId: string,
): string | null {
  // Primary: `writeup-<paperId>-<iso>.md` (the contract). Secondary:
  // `writeup-<paperId>.md` for the case where a smaller model drops the
  // timestamp segment. We never accept a bare `writeup.md` here — without the
  // paperId we cannot tell which paper it belongs to in a multi-paper bundle.
  const timestampedPrefix = `writeup-${paperId}-`;
  const timestamped = names.filter((n) => n.startsWith(timestampedPrefix) && n.endsWith(".md"));
  if (timestamped.length > 0) return [...timestamped].sort().at(-1) ?? null;
  const bareWithPaperId = `writeup-${paperId}.md`;
  if (names.includes(bareWithPaperId)) return bareWithPaperId;
  return null;
}
