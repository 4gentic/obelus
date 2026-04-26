import { z } from "zod";

export const PLAN_EMPTY_REASONS = [
  "praise",
  "ambiguous",
  "structural-note",
  "no-edit-requested",
] as const;

export type PlanEmptyReason = (typeof PLAN_EMPTY_REASONS)[number];

const EmptyReason = z.enum(PLAN_EMPTY_REASONS);

// Synthesised blocks the planner produces on top of user marks. The first
// element of `annotationIds` carries the synthesised id, which downstream
// code keys on by prefix. `impact-` and `coherence-` carry an empty patch by
// contract; `cascade-`, `quality-`, and `compile-` carry a real edit.
const EMPTY_PATCH_SYNTHESIS_PREFIXES = ["impact-", "coherence-"] as const;

// Per-prefix `reviewerNotes` prefix the SKILL.md (`plan-fix`) requires.
// Coherence notes describe drift between two ids and have no single source —
// they only need to be non-empty.
const REVIEWER_NOTES_PREFIX = {
  "impact-": "Impact of ",
  "cascade-": "Cascaded from ",
  "quality-": "Quality pass: ",
} as const;

function startsWithAny(id: string, prefixes: ReadonlyArray<string>): boolean {
  return prefixes.some((p) => id.startsWith(p));
}

function findPrefix<T extends string>(id: string, table: Readonly<Record<T, string>>): T | null {
  for (const key of Object.keys(table) as T[]) {
    if (id.startsWith(key)) return key;
  }
  return null;
}

export const PlanBlock = z
  .object({
    annotationIds: z.array(z.string()).min(1),
    file: z.string(),
    category: z.string(),
    patch: z.string(),
    ambiguous: z.boolean(),
    reviewerNotes: z.string(),
    emptyReason: EmptyReason.nullable(),
  })
  .superRefine((b, ctx) => {
    const firstId = b.annotationIds[0] ?? "";
    const requiresEmptyPatch = startsWithAny(firstId, EMPTY_PATCH_SYNTHESIS_PREFIXES);
    if (b.patch === "") {
      if (b.emptyReason === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["emptyReason"],
          message: "empty patch requires an emptyReason",
        });
        return;
      }
      if (b.emptyReason === "ambiguous" && !b.ambiguous) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ambiguous"],
          message: "emptyReason 'ambiguous' requires ambiguous: true",
        });
      }
      if (b.emptyReason === "structural-note") {
        if (!requiresEmptyPatch) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["emptyReason"],
            message: "emptyReason 'structural-note' is only valid on impact-/coherence- blocks",
          });
        }
        // The original empty-`reviewerNotes` regression: a structural-note
        // block with no notes renders as a content-less header chip in the
        // desktop UI and is useless. Belt-and-braces with the per-prefix
        // checks below.
        if (b.reviewerNotes.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["reviewerNotes"],
            message: "structural-note blocks require non-empty reviewerNotes",
          });
        }
      }
    } else {
      // Non-empty patch.
      if (b.emptyReason !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["emptyReason"],
          message: "non-empty patch must not carry an emptyReason",
        });
      }
      if (b.ambiguous) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ambiguous"],
          message: "ambiguous: true requires patch: \"\" (with emptyReason: 'ambiguous')",
        });
      }
      if (requiresEmptyPatch) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["patch"],
          message: `${firstId.split("-")[0]}-* blocks must carry an empty patch`,
        });
      }
    }
    // Synthesised-prefix `reviewerNotes` enforcement. Substantive check is
    // character-count, not semantic — the prompt + per-hunk review enforce
    // meaning. Coherence notes (no single source id) are caught by the
    // length check below.
    const prefixKey = findPrefix(firstId, REVIEWER_NOTES_PREFIX);
    if (prefixKey !== null) {
      const required = REVIEWER_NOTES_PREFIX[prefixKey];
      // Check the prefix against the raw notes (the required strings end in
      // a space) and check substantive content against the trimmed remainder.
      if (!b.reviewerNotes.startsWith(required)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reviewerNotes"],
          message: `${prefixKey}* blocks require reviewerNotes starting with "${required}"`,
        });
      } else if (b.reviewerNotes.slice(required.length).trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reviewerNotes"],
          message: `${prefixKey}* blocks require substantive reviewerNotes after the "${required}" prefix`,
        });
      }
    } else if (firstId.startsWith("coherence-") && b.reviewerNotes.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reviewerNotes"],
        message: "coherence-* blocks require non-empty reviewerNotes",
      });
    }
  });

export const PlanFile = z.object({
  bundleId: z.string(),
  format: z.enum(["typst", "latex", "markdown", "html", ""]),
  entrypoint: z.string(),
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
