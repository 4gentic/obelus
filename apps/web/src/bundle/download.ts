import type { PromptRubric } from "@obelus/bundle-builder";
import type { Bundle } from "@obelus/bundle-schema";
import { suggestBundleFilename } from "./build";
import { formatClipboardPrompt, formatReviewClipboardPrompt } from "./clipboard";

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
}

interface WritableStream {
  write(data: Blob | string): Promise<void>;
  close(): Promise<void>;
}

interface FileHandleLike {
  createWritable(): Promise<WritableStream>;
}

type SaveFilePicker = (opts: SaveFilePickerOptions) => Promise<FileHandleLike>;

function anchorDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function saveBlob(
  blob: Blob,
  suggestedName: string,
  description: string,
  accept: Record<string, string[]>,
): Promise<void> {
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (typeof picker === "function") {
    try {
      const handle = await picker({
        suggestedName,
        types: [{ description, accept }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    }
  }
  anchorDownload(blob, suggestedName);
}

export async function exportBundleFile(bundle: Bundle): Promise<void> {
  const suggestedName = suggestBundleFilename();
  const json = JSON.stringify(bundle, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  await saveBlob(blob, suggestedName, "Obelus bundle", {
    "application/json": [".json"],
  });
}

export async function exportBundleMarkdown(bundle: Bundle): Promise<void> {
  const suggestedName = suggestBundleFilename().replace(/\.json$/, ".md");
  const text = formatClipboardPrompt(bundle);
  const blob = new Blob([text], { type: "text/markdown" });
  await saveBlob(blob, suggestedName, "Obelus marks (Markdown)", {
    "text/markdown": [".md"],
  });
}

export async function exportReviewBundleMarkdown(
  bundle: Bundle,
  rubric?: PromptRubric,
): Promise<void> {
  const suggestedName = suggestBundleFilename().replace(/\.json$/, ".review.md");
  const text = formatReviewClipboardPrompt(bundle, rubric);
  const blob = new Blob([text], { type: "text/markdown" });
  await saveBlob(blob, suggestedName, "Obelus review write-up (Markdown)", {
    "text/markdown": [".review.md", ".md"],
  });
}
