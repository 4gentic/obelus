import type { Repository } from "@obelus/repo";
import { useEffect, useState } from "react";

// Reverse of `use-companion-paper`: given the open PDF, resolve the source it
// was compiled from — the same-stem `.tex`/`.typ` — validated against the
// project's scanned file index. Returns null when the open file isn't a PDF or
// no companion source exists (→ the "Show source" toggle stays hidden).
export function useCompanionSource(
  repo: Repository,
  projectId: string,
  pdfRelPath: string | null,
): string | null {
  const [source, setSource] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (pdfRelPath === null || !/\.pdf$/i.test(pdfRelPath)) {
      setSource(null);
      return;
    }
    const stem = pdfRelPath.replace(/\.pdf$/i, "");
    void (async () => {
      const rows = await repo.projectFiles.listForProject(projectId);
      const paths = new Set(rows.map((r) => r.relPath));
      const match =
        [`${stem}.tex`, `${stem}.typ`].find((candidate) => paths.has(candidate)) ?? null;
      if (!cancelled) setSource(match);
    })();
    return () => {
      cancelled = true;
    };
  }, [repo, projectId, pdfRelPath]);

  return source;
}
