import {
  BUNDLE_VERSION,
  BUNDLE_VERSION_V2,
  type Bundle,
  type Bundle2,
  BundleV1,
  BundleV2,
} from "@obelus/bundle-schema";

const DEFAULT_TOOL_VERSION = "0.1.0";

export interface PaperInput {
  id: string;
  title: string;
}

export interface RevisionInput {
  id: string;
  paperId: string;
  revisionNumber: number;
  pdfSha256: string;
  createdAt: string;
}

export interface PdfInput {
  filename: string;
  pageCount: number;
}

// `category` is intentionally `string`; BundleV1.parse enforces the enum at
// the boundary so callers can pass DB rows whose schemas don't narrow it.
export interface AnnotationInput {
  id: string;
  category: string;
  quote: string;
  contextBefore: string;
  contextAfter: string;
  page: number;
  bbox: readonly [number, number, number, number];
  textItemRange: {
    start: readonly [number, number];
    end: readonly [number, number];
  };
  note: string;
  thread: ReadonlyArray<{ at: string; body: string }>;
  createdAt: string;
  groupId?: string;
}

export interface BuildBundleV1Input {
  paper: PaperInput;
  revision: RevisionInput;
  pdf: PdfInput;
  annotations: ReadonlyArray<AnnotationInput>;
  toolVersion?: string;
}

export function buildBundleV1(input: BuildBundleV1Input): Bundle {
  if (input.revision.paperId !== input.paper.id) {
    throw new Error("revision/paper mismatch");
  }
  const candidate = {
    bundleVersion: BUNDLE_VERSION,
    tool: { name: "obelus", version: input.toolVersion ?? DEFAULT_TOOL_VERSION },
    pdf: {
      sha256: input.revision.pdfSha256,
      filename: input.pdf.filename,
      pageCount: input.pdf.pageCount,
    },
    paper: {
      id: input.paper.id,
      title: input.paper.title,
      revision: input.revision.revisionNumber,
      createdAt: input.revision.createdAt,
    },
    annotations: input.annotations.map((r) => ({
      id: r.id,
      category: r.category,
      quote: r.quote,
      contextBefore: r.contextBefore,
      contextAfter: r.contextAfter,
      page: r.page,
      bbox: r.bbox,
      textItemRange: r.textItemRange,
      note: r.note,
      thread: r.thread,
      createdAt: r.createdAt,
      ...(r.groupId ? { groupId: r.groupId } : {}),
    })),
  };
  return BundleV1.parse(candidate);
}

export interface PaperRefV2Input {
  id: string;
  title: string;
  revisionNumber: number;
  createdAt: string;
  pdfRelPath: string;
  pdfSha256: string;
  pageCount: number;
  entrypoint?: string;
}

export interface ProjectV2Input {
  id: string;
  label: string;
  kind: "folder" | "single-pdf" | "stack-pdf";
  categories: ReadonlyArray<{ slug: string; label: string; color?: string }>;
}

export interface AnnotationV2Input {
  id: string;
  paperId: string;
  category: string;
  quote: string;
  contextBefore: string;
  contextAfter: string;
  page: number;
  bbox: readonly [number, number, number, number];
  textItemRange: {
    start: readonly [number, number];
    end: readonly [number, number];
  };
  note: string;
  thread: ReadonlyArray<{ at: string; body: string }>;
  createdAt: string;
  groupId?: string;
}

export interface BuildBundleV2Input {
  project: ProjectV2Input;
  papers: ReadonlyArray<PaperRefV2Input>;
  annotations: ReadonlyArray<AnnotationV2Input>;
  toolVersion?: string;
}

export function buildBundleV2(input: BuildBundleV2Input): Bundle2 {
  const candidate = {
    bundleVersion: BUNDLE_VERSION_V2,
    tool: { name: "obelus", version: input.toolVersion ?? DEFAULT_TOOL_VERSION },
    project: {
      id: input.project.id,
      label: input.project.label,
      kind: input.project.kind,
      categories: input.project.categories.map((c) => ({
        slug: c.slug,
        label: c.label,
        ...(c.color !== undefined ? { color: c.color } : {}),
      })),
    },
    papers: input.papers.map((p) => ({
      id: p.id,
      title: p.title,
      revision: p.revisionNumber,
      createdAt: p.createdAt,
      pdf: {
        relPath: p.pdfRelPath,
        sha256: p.pdfSha256,
        pageCount: p.pageCount,
      },
      ...(p.entrypoint !== undefined ? { entrypoint: p.entrypoint } : {}),
    })),
    annotations: input.annotations.map((a) => ({
      id: a.id,
      paperId: a.paperId,
      category: a.category,
      quote: a.quote,
      contextBefore: a.contextBefore,
      contextAfter: a.contextAfter,
      anchor: {
        kind: "pdf" as const,
        page: a.page,
        bbox: a.bbox,
        textItemRange: a.textItemRange,
      },
      note: a.note,
      thread: a.thread,
      createdAt: a.createdAt,
      ...(a.groupId !== undefined ? { groupId: a.groupId } : {}),
    })),
  };
  return BundleV2.parse(candidate);
}

export {
  formatFixPrompt,
  formatReviewPrompt,
  type PromptAnnotation,
  type PromptInput,
  type PromptPaper,
  type PromptRubric,
} from "./format-prompts";

export function suggestBundleFilename(now: Date = new Date()): string {
  const pad = (n: number): string => n.toString().padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `review-${stamp}.obelus.json`;
}
