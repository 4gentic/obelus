import { z } from "zod";

// `Stage` mirrors the workflow stages described in `docs/drafter-design.md`.
// `iterate` is a logical state a section enters after a non-accept critique,
// not a command. The state machine in `state-machine.ts` defines which
// transitions are legal.
export const Stage = z.enum(["spec", "research", "draft", "critique", "iterate", "assemble"]);
export type Stage = z.infer<typeof Stage>;

// One entry per paper in the project. A project usually carries one paper
// (the common case), but may carry several — e.g. a journal version and a
// workshop version of the same work, or a paper and its companion supplement.
// All sections live in the same flat list (see `PaperDraft.sections`); each
// section names its paper via `paperSlug`. This keeps the state file singular
// at the project root and lets the UI render every paper's sections at once,
// grouped by paper.
export const Paper = z.object({
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "slug must be lowercase kebab-case"),
  title: z.string().min(1),
  // Path to this paper's user-edited Goal File, relative to project root. The
  // drafter never writes here; every persona reads it as binding framing.
  goalPath: z.string().min(1),
});
export type Paper = z.infer<typeof Paper>;

// One section per directory under `paper/<paper-slug>/sections/<NN>-<slug>/`.
// The drafter records the on-disk paths so the desktop UI does not have to
// re-detect the project's source format on every render.
export const Section = z.object({
  // The paper this section belongs to. Must match a `Paper.slug` in the same
  // `PaperDraft`; cross-validation is enforced by the top-level refinement.
  paperSlug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "slug must be lowercase kebab-case"),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "slug must be lowercase kebab-case"),
  title: z.string().min(1),
  ordinal: z.number().int().nonnegative(),
  stage: Stage,
  // Path to the section's draft file, relative to project root. The extension
  // follows the project's source format: `.md` / `.tex` / `.typ`.
  sourcePath: z.string().min(1),
  // Path to the section's spec file, relative to project root. Optional
  // because a section can exist without a written spec (e.g. early manual
  // drafts the user wrote outside the workflow).
  specPath: z.string().min(1).optional(),
  // ISO 8601 UTC timestamp of the most recent stage transition.
  lastUpdated: z.string().datetime({ offset: false }),
});
export type Section = z.infer<typeof Section>;

export const PaperDraft = z
  .object({
    version: z.literal("1.0"),
    papers: z.array(Paper).min(1),
    sections: z.array(Section),
  })
  .superRefine((draft, ctx) => {
    const paperSlugs = new Set(draft.papers.map((p) => p.slug));
    if (paperSlugs.size !== draft.papers.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "papers[].slug must be unique within a draft",
        path: ["papers"],
      });
    }
    for (const [i, section] of draft.sections.entries()) {
      if (!paperSlugs.has(section.paperSlug)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `sections[${i}].paperSlug "${section.paperSlug}" does not match any papers[].slug`,
          path: ["sections", i, "paperSlug"],
        });
      }
    }
  });
export type PaperDraft = z.infer<typeof PaperDraft>;

export const PAPER_DRAFT_VERSION = "1.0" as const;
