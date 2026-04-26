import type { PaperFormat, Repository } from "@obelus/repo";
import { save } from "@tauri-apps/plugin-dialog";
import { fsWriteTextAbs } from "../ipc/commands";
import {
  type ExportedBundle,
  exportBundleForPaper,
  exportHtmlBundleForPaper,
  exportMdBundleForPaper,
} from "../routes/project/build-bundle";

export interface ExportPaperInput {
  repo: Repository;
  paperId: string;
  format: PaperFormat;
  // Project root passed through to the PDF exporter so source-anchor upgrades
  // can read sibling .tex/.typ/.md files. Optional because the home view
  // doesn't carry it.
  rootId?: string;
}

export interface ExportPaperReport {
  savedTo: string | null;
}

async function buildBundleForFormat(input: ExportPaperInput): Promise<ExportedBundle> {
  const { repo, paperId, format, rootId } = input;
  if (format === "md") return exportMdBundleForPaper({ repo, paperId });
  if (format === "html") return exportHtmlBundleForPaper({ repo, paperId });
  return exportBundleForPaper({ repo, paperId, ...(rootId !== undefined ? { rootId } : {}) });
}

// Opens a native save dialog and writes the paper's review bundle JSON to the
// chosen path. Returns `savedTo: null` if the user cancelled. The dialog is
// the trust boundary, so we use `fsWriteTextAbs` rather than the
// project-root-scoped writer.
export async function exportPaperToFile(input: ExportPaperInput): Promise<ExportPaperReport> {
  const bundle = await buildBundleForFormat(input);
  const picked = await save({
    defaultPath: bundle.filename,
    filters: [{ name: "Bundle", extensions: ["json"] }],
  });
  if (!picked) return { savedTo: null };
  await fsWriteTextAbs(picked, bundle.json);
  return { savedTo: picked };
}
