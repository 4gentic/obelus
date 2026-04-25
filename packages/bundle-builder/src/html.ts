import type { AnnotationAnchor, AnnotationInput } from "./index";

// Structural row shape — both apps' Repo layers (`@obelus/repo` web and
// SQLite implementations) produce this set of fields. Typed structurally so
// `@obelus/bundle-builder` stays free of a `@obelus/repo` dependency.
export interface HtmlMapAnchorPdf {
  kind: "pdf";
  page: number;
  bbox: readonly [number, number, number, number];
  textItemRange: {
    start: readonly [number, number];
    end: readonly [number, number];
  };
}

export interface HtmlMapAnchorSource {
  kind: "source";
  file: string;
  lineStart: number;
  colStart: number;
  lineEnd: number;
  colEnd: number;
}

export interface HtmlMapAnchorHtml {
  kind: "html";
  file: string;
  xpath: string;
  charOffsetStart: number;
  charOffsetEnd: number;
  // `T | undefined` (not `?: T`) so the type accepts the Zod-inferred row
  // shape from `@obelus/repo`, where `.optional()` widens to include explicit
  // undefined under `exactOptionalPropertyTypes: true`.
  sourceHint?: HtmlMapAnchorSource | undefined;
}

export interface HtmlMapAnchorHtmlElement {
  kind: "html-element";
  file: string;
  xpath: string;
  sourceHint?: HtmlMapAnchorSource | undefined;
}

export type HtmlMapAnchor =
  | HtmlMapAnchorPdf
  | HtmlMapAnchorSource
  | HtmlMapAnchorHtml
  | HtmlMapAnchorHtmlElement;

export interface HtmlMapRow {
  id: string;
  category: string;
  quote: string;
  contextBefore: string;
  contextAfter: string;
  anchor: HtmlMapAnchor;
  note: string;
  thread: ReadonlyArray<{ at: string; body: string }>;
  createdAt: string;
  groupId?: string;
}

export interface HtmlMapResult {
  annotations: AnnotationInput[];
  droppedForPdfAnchor: string[];
  seenKinds: Set<"source" | "html" | "html-element">;
  firstSourceFile: string | null;
}

// Pure mapping from repo annotation rows to bundle annotations for HTML
// papers. PDF anchors are dropped (HTML papers don't carry compiled PDFs);
// `source` and `html` anchors pass through with the html arm reshaped to the
// wire fields. Callers apply their own logging, mixed-kind validation, and
// entrypoint policy on top of this result — desktop wants strict
// one-mode-per-paper enforcement, web takes a classification-derived
// entrypoint and accepts mixed silently.
export function mapHtmlAnnotations(
  rows: ReadonlyArray<HtmlMapRow>,
  paperId: string,
): HtmlMapResult {
  const annotations: AnnotationInput[] = [];
  const droppedForPdfAnchor: string[] = [];
  const seenKinds = new Set<"source" | "html" | "html-element">();
  let firstSourceFile: string | null = null;
  for (const row of rows) {
    if (row.anchor.kind === "pdf") {
      droppedForPdfAnchor.push(row.id);
      continue;
    }
    seenKinds.add(row.anchor.kind);
    if (row.anchor.kind === "source" && firstSourceFile === null) {
      firstSourceFile = row.anchor.file;
    }
    let anchor: AnnotationAnchor;
    if (row.anchor.kind === "html") {
      anchor = {
        kind: "html",
        file: row.anchor.file,
        xpath: row.anchor.xpath,
        charOffsetStart: row.anchor.charOffsetStart,
        charOffsetEnd: row.anchor.charOffsetEnd,
        ...(row.anchor.sourceHint !== undefined ? { sourceHint: row.anchor.sourceHint } : {}),
      };
    } else if (row.anchor.kind === "html-element") {
      anchor = {
        kind: "html-element",
        file: row.anchor.file,
        xpath: row.anchor.xpath,
        ...(row.anchor.sourceHint !== undefined ? { sourceHint: row.anchor.sourceHint } : {}),
      };
    } else {
      anchor = row.anchor;
    }
    annotations.push({
      id: row.id,
      paperId,
      category: row.category,
      quote: row.quote,
      contextBefore: row.contextBefore,
      contextAfter: row.contextAfter,
      anchor,
      note: row.note,
      thread: row.thread,
      createdAt: row.createdAt,
      ...(row.groupId !== undefined ? { groupId: row.groupId } : {}),
    });
  }
  return { annotations, droppedForPdfAnchor, seenKinds, firstSourceFile };
}
