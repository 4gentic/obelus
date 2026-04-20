import { z } from "zod";

export const BUNDLE_VERSION_V2 = "2.0" as const;

// A relative POSIX path, rooted inside the paper repo. Rejects absolute paths
// (Unix `/foo`, Windows `C:\foo`), `..` segments, and backslash separators.
// Consumers (e.g. the Claude plugin) resolve these against a repo root and
// must not follow a path that escapes it.
const relPosixPath = z
  .string()
  .min(1)
  .refine((p) => !/^\//.test(p), { message: "absolute POSIX path is not allowed" })
  .refine((p) => !/^[A-Za-z]:/.test(p), { message: "absolute Windows path is not allowed" })
  .refine((p) => !p.includes("\\"), {
    message: "backslash separators are not allowed (POSIX only)",
  })
  .refine((p) => !p.split("/").includes(".."), {
    message: "`..` path segments are not allowed",
  });

const Bbox = z.tuple([z.number(), z.number(), z.number(), z.number()]);

const TextItemRange = z.object({
  start: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
  end: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
});

export const PdfAnchor = z.object({
  kind: z.literal("pdf"),
  page: z.number().int().positive(),
  bbox: Bbox,
  textItemRange: TextItemRange,
});

export const SourceAnchor = z.object({
  kind: z.literal("source"),
  file: relPosixPath,
  lineStart: z.number().int().positive(),
  colStart: z.number().int().nonnegative(),
  lineEnd: z.number().int().positive(),
  colEnd: z.number().int().nonnegative(),
});

export const HtmlAnchor = z.object({
  kind: z.literal("html"),
  file: relPosixPath,
  xpath: z.string().min(1),
  charOffsetStart: z.number().int().nonnegative(),
  charOffsetEnd: z.number().int().nonnegative(),
  sourceHint: SourceAnchor.optional(),
});

export const Anchor = z.discriminatedUnion("kind", [PdfAnchor, SourceAnchor, HtmlAnchor]);

const ThreadEntry = z.object({
  at: z.string().datetime({ offset: false }),
  body: z.string(),
});

export const ProjectCategory = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9-]*$/),
  label: z.string().min(1),
  color: z.string().optional(),
});

export const ProjectKind = z.enum(["folder", "single-pdf", "stack-pdf"]);

const Project = z.object({
  id: z.string().uuid(),
  label: z.string().min(1),
  kind: ProjectKind,
  categories: z.array(ProjectCategory).min(1),
});

const PaperRefV2 = z.object({
  id: z.string().uuid(),
  title: z.string(),
  revision: z.number().int().positive(),
  createdAt: z.string().datetime({ offset: false }),
  pdf: z
    .object({
      relPath: relPosixPath,
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      pageCount: z.number().int().positive(),
    })
    .optional(),
  entrypoint: relPosixPath.optional(),
});

// `category` is a free string; the cross-field check below enforces it against
// `project.categories[].slug`. v2 replaces v1's global enum with per-project categories.
export const AnnotationV2 = z.object({
  id: z.string().uuid(),
  paperId: z.string().uuid(),
  category: z.string().min(1),
  quote: z.string().min(1),
  contextBefore: z.string(),
  contextAfter: z.string(),
  anchor: Anchor,
  note: z.string().default(""),
  thread: z.array(ThreadEntry).default([]),
  createdAt: z.string().datetime({ offset: false }),
  groupId: z.string().uuid().optional(),
});

export const BundleV2 = z
  .object({
    bundleVersion: z.literal(BUNDLE_VERSION_V2),
    tool: z.object({
      name: z.literal("obelus"),
      version: z.string(),
    }),
    project: Project,
    papers: z.array(PaperRefV2).min(1),
    annotations: z.array(AnnotationV2),
  })
  .superRefine((bundle, ctx) => {
    const paperIds = new Set(bundle.papers.map((p) => p.id));
    const categorySlugs = new Set(bundle.project.categories.map((c) => c.slug));
    bundle.annotations.forEach((a, i) => {
      if (!paperIds.has(a.paperId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["annotations", i, "paperId"],
          message: `paperId ${a.paperId} has no matching paper`,
        });
      }
      if (!categorySlugs.has(a.category)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["annotations", i, "category"],
          message: `category "${a.category}" is not in project.categories`,
        });
      }
    });
  });
