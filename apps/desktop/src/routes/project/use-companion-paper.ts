import type { Repository } from "@obelus/repo";
import { useEffect, useState } from "react";

function dirOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

// Resolves the paper a given source file should compile into / be reviewed
// against, used when the source itself is the open file so
// OpenPaper.usePaperId() returns null.
//
// Match order:
//   1. companion PDF of the same stem (foo/main.tex ↔ foo/main.pdf)
//   2. any paper whose PDF lives in the same directory or an ancestor.
//
// Returns null when no paper fits — typical for a freshly-cloned repo where
// the .pdf hasn't been compiled yet. Callers must tolerate that case (e.g.
// disable Fix-with-AI; let Compile run unconditionally and create the paper
// by bounce-opening the produced PDF).
export function useCompanionPaperId(
  repo: Repository,
  projectId: string,
  relPath: string | null,
): string | null {
  const [paperId, setPaperId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (relPath === null) {
      setPaperId(null);
      return;
    }
    void (async () => {
      const all = await repo.papers.list();
      const inProject = all.filter((p) => p.projectId === projectId && p.removedAt === undefined);

      const companionPdf = relPath.replace(/\.[^./]+$/, ".pdf");
      const byCompanion = inProject.find(
        (p) => p.pdfRelPath !== undefined && p.pdfRelPath === companionPdf,
      );

      const relDir = dirOf(relPath);
      const byDir = byCompanion
        ? undefined
        : inProject.find((p) => {
            if (p.pdfRelPath === undefined) return false;
            const pd = dirOf(p.pdfRelPath);
            if (pd === "" && relDir !== "") return false;
            return pd === relDir || relPath.startsWith(`${pd}/`);
          });

      const resolved = byCompanion?.id ?? byDir?.id ?? null;
      if (!cancelled) setPaperId(resolved);
    })();
    return () => {
      cancelled = true;
    };
  }, [repo, projectId, relPath]);

  return paperId;
}
