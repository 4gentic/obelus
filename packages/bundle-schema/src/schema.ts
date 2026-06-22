import { z } from "zod";

export const BUNDLE_VERSION = "1.0" as const;

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
  // Line range of the enclosing section/block, derived from the file's section
  // map at export time. A navigation hint: the plugin can read the whole scope
  // in one shot instead of widening a Read window by trial and error. Omitted
  // when no section encloses the anchor (e.g. preamble before the first
  // heading) or when source structure wasn't available.
  scopeStart: z.number().int().positive().optional(),
  scopeEnd: z.number().int().positive().optional(),
});

export const HtmlAnchor = z.object({
  kind: z.literal("html"),
  file: relPosixPath,
  xpath: z.string().min(1),
  charOffsetStart: z.number().int().nonnegative(),
  charOffsetEnd: z.number().int().nonnegative(),
  sourceHint: SourceAnchor.optional(),
});

// Reference to a discrete HTML element rather than a text range — the case the
// `HtmlAnchor` text walk can't represent (e.g. `<img>`, which has no text
// content). The XPath resolves to the element itself; resolvers draw the
// highlight from the element's own bounding rect.
export const HtmlElementAnchor = z.object({
  kind: z.literal("html-element"),
  file: relPosixPath,
  xpath: z.string().min(1),
  sourceHint: SourceAnchor.optional(),
});

export const Anchor = z.discriminatedUnion("kind", [
  PdfAnchor,
  SourceAnchor,
  HtmlAnchor,
  HtmlElementAnchor,
]);

export const ThreadEntry = z.object({
  at: z.string().datetime({ offset: false }),
  body: z.string(),
});

export const ProjectCategory = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9-]*$/),
  label: z.string().min(1),
  color: z.string().optional(),
});

export const ProjectKind = z.enum(["writer", "reviewer"]);

export const ProjectFileFormat = z.enum([
  "tex",
  "md",
  "typ",
  "bib",
  "cls",
  "sty",
  "bst",
  "pdf",
  "yml",
  "json",
  "txt",
  "other",
]);

export const ProjectFileRole = z.enum(["main", "include", "bib", "asset"]);

// One heading in a source file's structure, with the 1-based inclusive line
// range it spans (`lineStart` is the heading line; `lineEnd` is the line
// before the next sibling-or-shallower heading, or the file's last line).
// `level` is the nesting depth (1 = top section, 2 = subsection, …) so the
// model can reconstruct the outline without re-parsing.
export const SourceSection = z.object({
  heading: z.string(),
  level: z.number().int().positive(),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive(),
});

export const ProjectFileSummary = z.object({
  relPath: relPosixPath,
  format: ProjectFileFormat,
  role: ProjectFileRole.optional(),
  // Heading outline of this file, extracted from source at export time. Lets
  // the model navigate to a section by line range instead of grepping.
  // Omitted for files with no detectable structure (e.g. a `.bib`) or when
  // source bytes weren't available at export.
  sections: z.array(SourceSection).optional(),
});

const Project = z.object({
  id: z.string().uuid(),
  label: z.string().min(1),
  kind: ProjectKind,
  categories: z.array(ProjectCategory).min(1),
  main: relPosixPath.optional(),
  files: z.array(ProjectFileSummary).optional(),
});

// Framing the plugin should honour as *data*, never as instructions. The
// writer's paper lens — rejection criteria, audience, tone. Optional.
export const PaperRubric = z.object({
  body: z.string(),
  label: z.string().min(1),
  source: z.enum(["file", "paste", "inline"]),
});

const PaperRefSchema = z.object({
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
  rubric: PaperRubric.optional(),
});

// A citation key referenced by the paper's prose (`\cite{key}`, `[@key]`,
// `@key`). `count` is how many references point at it across all indexed
// sources — a cheap signal of which keys carry the argument vs. which appear
// once. `key` is the bare citation key as written; we don't resolve it against
// a `.bib` entry (the raw label or title would require parsing the
// bibliography, which is out of scope for this index).
export const Citation = z.object({
  key: z.string().min(1),
  count: z.number().int().positive(),
});

// `category` is a free string; the cross-field check below enforces it against
// `project.categories[].slug`.
export const Annotation = z.object({
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

export const Bundle = z
  .object({
    bundleVersion: z.literal(BUNDLE_VERSION),
    tool: z.object({
      name: z.literal("obelus"),
      version: z.string(),
    }),
    project: Project,
    papers: z.array(PaperRefSchema).min(1),
    annotations: z.array(Annotation),
    // Project-wide citation index, deduplicated across every indexed source.
    // Top-level rather than per-paper because the keys reference a shared
    // bibliography: a `\cite` in an included file resolves against the same
    // `.bib` as the main file, so one index serves the whole review. Omitted
    // when no source was indexed or the paper cites nothing.
    citations: z.array(Citation).optional(),
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

export { PaperRefSchema as PaperRef };

export type Bundle = z.infer<typeof Bundle>;
export type Annotation = z.infer<typeof Annotation>;
export type Anchor = z.infer<typeof Anchor>;
export type PdfAnchor = z.infer<typeof PdfAnchor>;
export type SourceAnchor = z.infer<typeof SourceAnchor>;
export type HtmlAnchor = z.infer<typeof HtmlAnchor>;
export type HtmlElementAnchor = z.infer<typeof HtmlElementAnchor>;
export type ProjectCategory = z.infer<typeof ProjectCategory>;
export type ProjectFileSummary = z.infer<typeof ProjectFileSummary>;
export type SourceSection = z.infer<typeof SourceSection>;
export type Citation = z.infer<typeof Citation>;
export type ProjectKind = z.infer<typeof ProjectKind>;
export type PaperRubric = z.infer<typeof PaperRubric>;
export type PaperRef = Bundle["papers"][number];
export type Project = Bundle["project"];
export type Thread = Annotation["thread"];
