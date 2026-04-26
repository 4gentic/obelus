import type { PaperRow, Repository } from "@obelus/repo";
import { open } from "@tauri-apps/plugin-dialog";
import { fsWriteTextAbs } from "../ipc/commands";
import {
  type ExportedBundle,
  exportBundleForPaper,
  exportHtmlBundleForPaper,
  exportMdBundleForPaper,
} from "../routes/project/build-bundle";

export interface ExportProjectInput {
  repo: Repository;
  projectId: string;
  rootId?: string;
}

export interface ExportProjectReport {
  // Absolute path of the directory the user picked; null if they cancelled or
  // the project has no papers to export.
  dir: string | null;
  savedCount: number;
  failed: Array<{ paperId: string; reason: string }>;
}

async function buildOne(input: {
  repo: Repository;
  paper: PaperRow;
  rootId?: string;
}): Promise<ExportedBundle> {
  const { repo, paper, rootId } = input;
  if (paper.format === "md") return exportMdBundleForPaper({ repo, paperId: paper.id });
  if (paper.format === "html") return exportHtmlBundleForPaper({ repo, paperId: paper.id });
  if (paper.format === "pdf")
    return exportBundleForPaper({
      repo,
      paperId: paper.id,
      ...(rootId !== undefined ? { rootId } : {}),
    });
  paper.format satisfies never;
  throw new Error(`unsupported paper format: ${String(paper.format)}`);
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
}

// Writes one bundle JSON per non-removed paper into a user-picked directory.
// On a per-paper failure (e.g. a paper without a revision) we keep going and
// surface the failures alongside the success count, so a single bad row
// doesn't sink the whole export.
export async function exportProjectToDirectory(
  input: ExportProjectInput,
): Promise<ExportProjectReport> {
  const { repo, projectId, rootId } = input;
  const all = await repo.papers.list();
  const papers = all.filter((p) => p.projectId === projectId && p.removedAt === undefined);
  if (papers.length === 0) {
    return { dir: null, savedCount: 0, failed: [] };
  }
  const picked = await open({ directory: true, multiple: false });
  if (typeof picked !== "string") return { dir: null, savedCount: 0, failed: [] };

  let savedCount = 0;
  const failed: Array<{ paperId: string; reason: string }> = [];
  for (const paper of papers) {
    try {
      const bundle = await buildOne({
        repo,
        paper,
        ...(rootId !== undefined ? { rootId } : {}),
      });
      await fsWriteTextAbs(joinPath(picked, bundle.filename), bundle.json);
      savedCount += 1;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failed.push({ paperId: paper.id, reason });
      console.warn("[project-export] paper failed", { paperId: paper.id, reason });
    }
  }
  console.info("[project-export]", {
    projectId,
    dir: picked,
    savedCount,
    failedCount: failed.length,
  });
  return { dir: picked, savedCount, failed };
}
