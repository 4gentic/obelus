import {
  formatFixPrompt,
  formatReviewPrompt,
  type PromptAnnotation,
  type PromptInput,
  type PromptRubric,
} from "@obelus/bundle-builder";
import type { Bundle } from "@obelus/bundle-schema";

function bundleToPromptInput(bundle: Bundle, rubric?: PromptRubric): PromptInput {
  const annotations: PromptAnnotation[] = bundle.annotations.map((a) => ({
    id: a.id,
    category: a.category,
    page: a.page,
    quote: a.quote,
    contextBefore: a.contextBefore,
    contextAfter: a.contextAfter,
    note: a.note,
    ...(a.groupId !== undefined ? { groupId: a.groupId } : {}),
  }));
  return {
    paper: {
      title: bundle.paper.title,
      revisionNumber: bundle.paper.revision,
      pdfFilename: bundle.pdf.filename,
      pdfSha256: bundle.pdf.sha256,
    },
    annotations,
    ...(rubric ? { rubric } : {}),
  };
}

export function formatClipboardPrompt(bundle: Bundle): string {
  return formatFixPrompt(bundleToPromptInput(bundle));
}

export async function copyClipboardPrompt(bundle: Bundle): Promise<void> {
  const text = formatClipboardPrompt(bundle);
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
