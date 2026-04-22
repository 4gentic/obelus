import { z } from "zod";
import { ProjectFileFormat, ProjectFileRole, ProjectKind } from "./schema-v2.js";

// The on-disk mirror of project metadata, written to `.obelus/project.json` by
// the desktop app and consumed by the Claude Code plugin. Keeping the schema
// here (next to bundle-v2) guarantees a single source of truth across the
// desktop export, the plugin, and any external tooling.

export const PROJECT_META_VERSION = 1 as const;

export const PaperBuildFormat = z.enum(["tex", "md", "typ"]);
export const PaperBuildCompiler = z.enum(["typst", "latexmk", "pandoc", "xelatex", "pdflatex"]);

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

export const ProjectMetaFile = z.object({
  relPath: relPosixPath,
  format: ProjectFileFormat,
  role: ProjectFileRole.optional(),
  size: z.number().int().nonnegative(),
  mtimeMs: z.number().int().nonnegative(),
});

export const ProjectMetaCompile = z.object({
  compiler: PaperBuildCompiler.nullable(),
  args: z.array(z.string()).default([]),
  outputRelDir: z.string().nullable().optional(),
});

export const ProjectMeta = z.object({
  version: z.literal(PROJECT_META_VERSION),
  projectId: z.string().uuid(),
  label: z.string().min(1),
  kind: ProjectKind,
  format: PaperBuildFormat.nullable(),
  main: relPosixPath.nullable(),
  mainIsPinned: z.boolean(),
  compile: ProjectMetaCompile,
  files: z.array(ProjectMetaFile),
  scannedAt: z.string().datetime({ offset: false }),
});

export type ProjectMeta = z.infer<typeof ProjectMeta>;
export type ProjectMetaFile = z.infer<typeof ProjectMetaFile>;
export type ProjectMetaCompile = z.infer<typeof ProjectMetaCompile>;
