import {
  formatFixPrompt,
  formatReviewPrompt,
  type PromptAnnotation,
  type PromptInput,
  type PromptLocator,
  type PromptRubric,
} from "@obelus/bundle-builder";
import type { Bundle } from "@obelus/bundle-schema";

function anchorToLocator(
  anchor: Bundle["annotations"][number]["anchor"],
  pdfFile: string | undefined,
): PromptLocator {
  switch (anchor.kind) {
    case "pdf":
      return { kind: "pdf", file: pdfFile ?? "paper.pdf", page: anchor.page };
    case "source":
      return {
        kind: "source",
        file: anchor.file,
        lineStart: anchor.lineStart,
        lineEnd: anchor.lineEnd,
      };
    case "html":
      return {
        kind: "html",
        file: anchor.file,
        xpath: anchor.xpath,
        ...(anchor.sourceHint
          ? {
              sourceHint: {
                file: anchor.sourceHint.file,
                lineStart: anchor.sourceHint.lineStart,
              },
            }
          : {}),
      };
    case "html-element":
      return {
        kind: "html-element",
        file: anchor.file,
        xpath: anchor.xpath,
        ...(anchor.sourceHint
          ? {
              sourceHint: {
                file: anchor.sourceHint.file,
                lineStart: anchor.sourceHint.lineStart,
              },
            }
          : {}),
      };
  }
}

function bundleToPromptInput(bundle: Bundle, rubric?: PromptRubric): PromptInput {
  const paper = bundle.papers[0];
  if (!paper) throw new Error("bundle has no papers");
  const entrypoint = paper.entrypoint ?? bundle.project.main ?? paper.pdf?.relPath ?? paper.title;
  const pdfFile = paper.pdf?.relPath;
  const annotations: PromptAnnotation[] = bundle.annotations.map((a) => ({
    id: a.id,
    category: a.category,
    quote: a.quote,
    contextBefore: a.contextBefore,
    contextAfter: a.contextAfter,
    note: a.note,
    locator: anchorToLocator(a.anchor, pdfFile),
    ...(a.groupId !== undefined ? { groupId: a.groupId } : {}),
  }));
  return {
    paper: {
      title: paper.title,
      revisionNumber: paper.revision,
      entrypoint,
      ...(paper.pdf?.sha256 ? { sha256: paper.pdf.sha256 } : {}),
    },
    annotations,
    ...(rubric ? { rubric } : {}),
  };
}

export function formatClipboardPrompt(bundle: Bundle, rubric?: PromptRubric): string {
  return formatFixPrompt(bundleToPromptInput(bundle, rubric));
}

export async function copyClipboardPrompt(bundle: Bundle, rubric?: PromptRubric): Promise<void> {
  const text = formatClipboardPrompt(bundle, rubric);
  await navigator.clipboard.writeText(text);
}

export function formatReviewClipboardPrompt(bundle: Bundle, rubric?: PromptRubric): string {
  return formatReviewPrompt(bundleToPromptInput(bundle, rubric));
}

export async function copyReviewClipboardPrompt(
  bundle: Bundle,
  rubric?: PromptRubric,
): Promise<void> {
  const text = formatReviewClipboardPrompt(bundle, rubric);
  await navigator.clipboard.writeText(text);
}
