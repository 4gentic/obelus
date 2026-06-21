import type { Bundle as BundleType, Citation, SourceSection } from "@obelus/bundle-schema";
import { BUNDLE_VERSION, Bundle } from "@obelus/bundle-schema";
import {
  buildCitationIndex,
  extractCitationKeys,
  extractSections,
  isStructuredSourceFormat,
  scopeForLine,
} from "./extract";

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
      // Enclosing-section line range. Normally the builder fills these from the
      // section map; a caller may also pass them through pre-computed. `|
      // undefined` (not just `?:`) so the type accepts the Zod-inferred repo row
      // shape under `exactOptionalPropertyTypes`.
      scopeStart?: number | undefined;
      scopeEnd?: number | undefined;
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

// Decoded source bytes for the files the bundle references, keyed by the same
// `relPath` used in `project.files[]` and `source` anchors. When provided, the
// builder extracts the heading outline (`project.files[].sections`), the
// project-wide citation index (top-level `citations`), and per-anchor scope
// hints (`scopeStart`/`scopeEnd`). Omit it for PDF-only papers where source
// bytes aren't available; the structural fields then stay absent.
export interface BundleSourceInput {
  relPath: string;
  text: string;
}

export interface BuildBundleInput {
  project: ProjectInput;
  papers: ReadonlyArray<PaperRefInput>;
  annotations: ReadonlyArray<AnnotationInput>;
  toolVersion?: string;
  sources?: ReadonlyArray<BundleSourceInput>;
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

interface ExtractedStructure {
  // Section outline keyed by relPath, for files whose source we indexed.
  sectionsByFile: Map<string, SourceSection[]>;
  // Project-wide deduplicated citation index (empty when nothing was cited).
  citations: Citation[];
}

// Resolve the `(format)` of a referenced file from `project.files[]`. Source
// text alone doesn't tell us the format unambiguously, so we trust the
// inventory the caller already classified.
function formatForPath(input: BuildBundleInput, relPath: string): string | undefined {
  return input.project.files?.find((f) => f.relPath === relPath)?.format;
}

function extractStructure(input: BuildBundleInput): ExtractedStructure {
  const sectionsByFile = new Map<string, SourceSection[]>();
  const citationKeys: string[] = [];
  for (const src of input.sources ?? []) {
    const format = formatForPath(input, src.relPath);
    if (format === undefined || !isStructuredSourceFormat(format)) continue;
    const sections = extractSections(src.text, format);
    if (sections.length > 0) sectionsByFile.set(src.relPath, sections);
    citationKeys.push(...extractCitationKeys(src.text, format));
  }
  return { sectionsByFile, citations: buildCitationIndex(citationKeys) };
}

// Attach `scopeStart`/`scopeEnd` to a `source` anchor from its file's section
// map. Non-source anchors and anchors whose enclosing section can't be found
// (preamble, unstructured file) pass through unchanged. Scope is keyed off
// `lineStart` — the line the reviewer's selection begins on.
function withScope(
  anchor: AnnotationAnchor,
  sectionsByFile: Map<string, SourceSection[]>,
): AnnotationAnchor {
  if (anchor.kind !== "source") return anchor;
  const sections = sectionsByFile.get(anchor.file);
  if (!sections) return anchor;
  const scope = scopeForLine(sections, anchor.lineStart);
  if (!scope) return anchor;
  return { ...anchor, scopeStart: scope.scopeStart, scopeEnd: scope.scopeEnd };
}

export function buildBundle(input: BuildBundleInput): BundleType {
  assertNoDelimiterCollisions(input);
  const structure = extractStructure(input);
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
            files: input.project.files.map((f) => {
              const sections = structure.sectionsByFile.get(f.relPath);
              return {
                relPath: f.relPath,
                format: f.format,
                ...(f.role !== undefined ? { role: f.role } : {}),
                ...(sections !== undefined ? { sections } : {}),
              };
            }),
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
      anchor: withScope(a.anchor, structure.sectionsByFile),
      note: a.note,
      thread: a.thread,
      createdAt: a.createdAt,
      ...(a.groupId !== undefined ? { groupId: a.groupId } : {}),
    })),
    ...(structure.citations.length > 0 ? { citations: structure.citations } : {}),
  };
  if (input.sources !== undefined && input.sources.length > 0) {
    let scopedAnchors = 0;
    let unscopedSourceAnchors = 0;
    for (const a of input.annotations) {
      if (a.anchor.kind !== "source") continue;
      const sections = structure.sectionsByFile.get(a.anchor.file);
      if (sections && scopeForLine(sections, a.anchor.lineStart)) scopedAnchors += 1;
      else unscopedSourceAnchors += 1;
    }
    let sectionCount = 0;
    for (const s of structure.sectionsByFile.values()) sectionCount += s.length;
    console.info("[bundle-structure]", {
      sourcesIndexed: input.sources.length,
      filesWithSections: structure.sectionsByFile.size,
      sectionCount,
      citationKeys: structure.citations.length,
      scopedAnchors,
      unscopedSourceAnchors,
    });
  }
  return Bundle.parse(candidate);
}

export {
  buildCitationIndex,
  extractCitationKeys,
  extractSections,
  isStructuredSourceFormat,
  type SourceFormat,
  scopeForLine,
} from "./extract";

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
