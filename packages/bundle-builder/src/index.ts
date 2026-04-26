import type { Bundle as BundleType } from "@obelus/bundle-schema";
import { BUNDLE_VERSION, Bundle } from "@obelus/bundle-schema";

const DEFAULT_TOOL_VERSION = "0.1.0";

export interface PaperRefInput {
  id: string;
  title: string;
  revisionNumber: number;
  createdAt: string;
  // PDF fields are present for writer-project reviews built around a compiled
  // PDF; reviewer-side markdown papers (no compile) leave them unset and rely
  // on `entrypoint` plus source-anchored annotations.
  pdfRelPath?: string;
  pdfSha256?: string;
  pageCount?: number;
  entrypoint?: string;
  rubric?: { body: string; label: string; source: "file" | "paste" | "inline" };
}

export interface ProjectFileSummaryInput {
  relPath: string;
  format:
    | "tex"
    | "md"
    | "typ"
    | "bib"
    | "cls"
    | "sty"
    | "bst"
    | "pdf"
    | "yml"
    | "json"
    | "txt"
    | "other";
  role?: "main" | "include" | "bib" | "asset";
}

export interface ProjectInput {
  id: string;
  label: string;
  kind: "writer" | "reviewer";
  categories: ReadonlyArray<{ slug: string; label: string; color?: string }>;
  // Cached tree hint for the Claude plugin (skip globbing when present).
  main?: string;
  files?: ReadonlyArray<ProjectFileSummaryInput>;
}

// Discriminated input anchor mirroring the bundle's wire shape. Callers pass
// either arm — the builder forwards it through `Bundle.parse` for canonical
// validation. The builder takes no responsibility for impossible cases; the
// row-side discriminant is the contract.
export type AnnotationAnchor =
  | {
      kind: "pdf";
      page: number;
      bbox: readonly [number, number, number, number];
      textItemRange: {
        start: readonly [number, number];
        end: readonly [number, number];
      };
    }
  | {
      kind: "source";
      file: string;
      lineStart: number;
      colStart: number;
      lineEnd: number;
      colEnd: number;
    }
  | {
      kind: "html";
      file: string;
      xpath: string;
      charOffsetStart: number;
      charOffsetEnd: number;
      sourceHint?: {
        kind: "source";
        file: string;
        lineStart: number;
        colStart: number;
        lineEnd: number;
        colEnd: number;
      };
    }
  | {
      kind: "html-element";
      file: string;
      xpath: string;
      sourceHint?: {
        kind: "source";
        file: string;
        lineStart: number;
        colStart: number;
        lineEnd: number;
        colEnd: number;
      };
    };

export interface AnnotationInput {
  id: string;
  paperId: string;
  category: string;
  quote: string;
  contextBefore: string;
  contextAfter: string;
  anchor: AnnotationAnchor;
  note: string;
  thread: ReadonlyArray<{ at: string; body: string }>;
  createdAt: string;
  groupId?: string;
}

export interface BuildBundleInput {
  project: ProjectInput;
  papers: ReadonlyArray<PaperRefInput>;
  annotations: ReadonlyArray<AnnotationInput>;
  toolVersion?: string;
}

// `<obelus:*>` literals are reserved as plugin-level markers (subagent fence
// delimiters and skill phase markers). Reviewer-supplied free text and rubric
// bodies must not carry them — a hit here is either a producer bug or an
// injection attempt, and the consuming skill would otherwise have to refuse at
// runtime. Failing fast at export keeps producer and consumer honest.
const OBELUS_DELIMITERS = [
  "<obelus:quote>",
  "<obelus:note>",
  "<obelus:context-before>",
  "<obelus:context-after>",
  "<obelus:rubric>",
  "<obelus:phase>",
] as const;

function findDelimiter(value: string): string | null {
  for (const lit of OBELUS_DELIMITERS) {
    if (value.includes(lit)) return lit;
  }
  return null;
}

// `paper.title` lands on a single line of the desktop's Pre-flight prelude
// (the prompt the model reads as ground truth). A newline or control character
// in the title would let an attacker forge what looks like a second prelude
// line; rejecting them at export keeps the consumer's line-oriented parser
// honest. U+0009 (\t) is allowed because it renders harmlessly inside a quoted
// title; everything else in C0 plus DEL is refused.
// biome-ignore lint/complexity/useRegexLiterals: \x0A and friends trip noControlCharactersInRegex in a literal
const TITLE_FORBIDDEN_CHARS = new RegExp("[\\x00-\\x08\\x0A-\\x1F\\x7F]");

function assertNoDelimiterCollisions(input: BuildBundleInput): void {
  for (const ann of input.annotations) {
    const fields = [
      ["quote", ann.quote],
      ["note", ann.note],
      ["contextBefore", ann.contextBefore],
      ["contextAfter", ann.contextAfter],
    ] as const;
    for (const [name, value] of fields) {
      const hit = findDelimiter(value);
      if (hit) {
        throw new Error(
          `bundle export refused: annotation ${ann.id} field "${name}" contains the reserved delimiter ${hit}`,
        );
      }
    }
    for (let i = 0; i < ann.thread.length; i++) {
      const entry = ann.thread[i];
      if (!entry) continue;
      const hit = findDelimiter(entry.body);
      if (hit) {
        throw new Error(
          `bundle export refused: annotation ${ann.id} thread[${i}].body contains the reserved delimiter ${hit}`,
        );
      }
    }
  }
  for (const paper of input.papers) {
    const titleHit = findDelimiter(paper.title);
    if (titleHit) {
      throw new Error(
        `bundle export refused: paper ${paper.id} title contains the reserved delimiter ${titleHit}`,
      );
    }
    if (TITLE_FORBIDDEN_CHARS.test(paper.title)) {
      throw new Error(
        `bundle export refused: paper ${paper.id} title contains a newline or control character`,
      );
    }
    if (paper.rubric === undefined) continue;
    const hit = findDelimiter(paper.rubric.body);
    if (hit) {
      throw new Error(
        `bundle export refused: paper ${paper.id} rubric.body contains the reserved delimiter ${hit}`,
      );
    }
  }
}

export function buildBundle(input: BuildBundleInput): BundleType {
  assertNoDelimiterCollisions(input);
  const candidate = {
    bundleVersion: BUNDLE_VERSION,
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
      ...(input.project.main !== undefined ? { main: input.project.main } : {}),
      ...(input.project.files !== undefined
        ? {
            files: input.project.files.map((f) => ({
              relPath: f.relPath,
              format: f.format,
              ...(f.role !== undefined ? { role: f.role } : {}),
            })),
          }
        : {}),
    },
    papers: input.papers.map((p) => ({
      id: p.id,
      title: p.title,
      revision: p.revisionNumber,
      createdAt: p.createdAt,
      ...(p.pdfRelPath !== undefined && p.pdfSha256 !== undefined && p.pageCount !== undefined
        ? {
            pdf: {
              relPath: p.pdfRelPath,
              sha256: p.pdfSha256,
              pageCount: p.pageCount,
            },
          }
        : {}),
      ...(p.entrypoint !== undefined ? { entrypoint: p.entrypoint } : {}),
      ...(p.rubric !== undefined ? { rubric: p.rubric } : {}),
    })),
    annotations: input.annotations.map((a) => ({
      id: a.id,
      paperId: a.paperId,
      category: a.category,
      quote: a.quote,
      contextBefore: a.contextBefore,
      contextAfter: a.contextAfter,
      anchor: a.anchor,
      note: a.note,
      thread: a.thread,
      createdAt: a.createdAt,
      ...(a.groupId !== undefined ? { groupId: a.groupId } : {}),
    })),
  };
  return Bundle.parse(candidate);
}

export {
  formatFixPrompt,
  formatReviewPrompt,
  type PromptAnnotation,
  type PromptInput,
  type PromptLocator,
  type PromptPaper,
  type PromptRubric,
} from "./format-prompts";

export {
  type HtmlMapAnchor,
  type HtmlMapAnchorHtml,
  type HtmlMapAnchorPdf,
  type HtmlMapAnchorSource,
  type HtmlMapResult,
  type HtmlMapRow,
  mapHtmlAnnotations,
} from "./html";

export type BundleKind = "review" | "revise";

export function suggestBundleFilename(kind: BundleKind, now: Date = new Date()): string {
  const pad = (n: number): string => n.toString().padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `obelus-${kind}-${stamp}.json`;
}
