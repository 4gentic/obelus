import type { PaperRow, WriteUpRow } from "@obelus/repo";
import type { JSX } from "react";
import { useEffect, useState } from "react";
import { fsListPdfs } from "../../ipc/commands";
import { useProject } from "./context";

interface PaperEntry {
  relPath: string;
  displayName: string;
  paperId: string | null;
  hasWriteUp: boolean;
}

function titleFromPath(relPath: string): string {
  const base = relPath.split("/").pop() ?? relPath;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

export default function PaperListColumn(): JSX.Element {
  const { project, rootId, repo, openFilePath, setOpenFilePath } = useProject();
  const [entries, setEntries] = useState<PaperEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const pdfs = await fsListPdfs(rootId);
        const allPapers = await repo.papers.list();
        const byRel = new Map<string, PaperRow>();
        for (const p of allPapers) {
          if (p.projectId === project.id && p.pdfRelPath) {
            byRel.set(p.pdfRelPath, p);
          }
        }
        const writeUps = repo.supports("writeUps")
          ? await repo.writeUps.listForProject(project.id)
          : ([] as WriteUpRow[]);
        const withWriteUp = new Set(
          writeUps.filter((w) => w.bodyMd.trim().length > 0).map((w) => w.paperId),
        );

        const next: PaperEntry[] = pdfs.map((relPath) => {
          const paper = byRel.get(relPath);
          const paperId = paper?.id ?? null;
          const hasWriteUp = paperId ? withWriteUp.has(paperId) : false;
          const displayName = paper?.title ?? titleFromPath(relPath);
          return { relPath, displayName, paperId, hasWriteUp };
        });
        if (!cancelled) {
          setEntries(next);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not read folder.");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project.id, repo, rootId]);

  return (
    <aside className="files">
      <div className="files__header">
        <span className="files__header-title">Papers</span>
        <span className="files__toggle" aria-disabled="true">
          {entries.length}
        </span>
      </div>
      {error && <p className="files__error">{error}</p>}
      {loading ? (
        <p className="files__hint">…</p>
      ) : (
        <ul className="files__tree files__tree--flat">
          {entries.map((e) => {
            const selected = openFilePath === e.relPath;
            return (
              <li key={e.relPath}>
                <button
                  type="button"
                  className={`files__row files__row--file${selected ? " files__row--selected" : ""}`}
                  onClick={() => setOpenFilePath(e.relPath)}
                >
                  <span className="files__caret" aria-hidden="true">
                    {e.hasWriteUp ? "✓" : ""}
                  </span>
                  <span className="files__name">{e.displayName}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
