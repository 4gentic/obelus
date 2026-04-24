import { z } from "zod";
import { PaperBuildCompiler, PaperBuildFormat } from "./project-meta.js";

export const COMPILE_ERROR_BUNDLE_VERSION = "compile-error/1.0" as const;

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

export const CompileErrorTrigger = z.enum(["apply", "manual"]);

export const CompileErrorMain = z.object({
  relPath: relPosixPath,
  format: PaperBuildFormat,
});

export const CompileErrorProject = z.object({
  rootLabel: z.string().min(1),
  main: CompileErrorMain,
});

export const CompileErrorTool = z.object({
  name: z.literal("obelus"),
  version: z.string().min(1),
});

export const CompileErrorBundle = z.object({
  bundleVersion: z.literal(COMPILE_ERROR_BUNDLE_VERSION),
  tool: CompileErrorTool,
  project: CompileErrorProject,
  paperId: z.string().uuid(),
  compiler: PaperBuildCompiler,
  engineVersion: z.string().optional(),
  stderr: z.string(),
  exitCode: z.number().int(),
  trigger: CompileErrorTrigger,
});

export type CompileErrorBundle = z.infer<typeof CompileErrorBundle>;
export type CompileErrorTrigger = z.infer<typeof CompileErrorTrigger>;
