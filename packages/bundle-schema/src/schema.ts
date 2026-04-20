import { z } from "zod";

export const BUNDLE_VERSION = "1.0" as const;

export const CategoryV1 = z.enum([
  "unclear",
  "wrong",
  "weak-argument",
  "citation-needed",
  "rephrase",
  "praise",
]);

const ThreadEntry = z.object({
  at: z.string().datetime({ offset: false }),
  body: z.string(),
});

const TextItemRange = z.object({
  start: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
  end: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
});

export const AnnotationV1 = z.object({
  id: z.string().uuid(),
  category: CategoryV1,
  quote: z.string().min(1),
  contextBefore: z.string(),
  contextAfter: z.string(),
  page: z.number().int().positive(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  textItemRange: TextItemRange,
  note: z.string().default(""),
  thread: z.array(ThreadEntry).default([]),
  createdAt: z.string().datetime({ offset: false }),
  // When a selection crossed pages, the web app emits one annotation per page
  // with a shared groupId so downstream tools can merge them back.
  groupId: z.string().uuid().optional(),
});

export const BundleV1 = z.object({
  bundleVersion: z.literal(BUNDLE_VERSION),
  tool: z.object({
    name: z.literal("obelus"),
    version: z.string(),
  }),
  pdf: z.object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    filename: z.string(),
    pageCount: z.number().int().positive(),
  }),
  paper: z.object({
    id: z.string().uuid(),
    title: z.string(),
    revision: z.number().int().positive(),
    createdAt: z.string().datetime({ offset: false }),
  }),
  annotations: z.array(AnnotationV1),
});
