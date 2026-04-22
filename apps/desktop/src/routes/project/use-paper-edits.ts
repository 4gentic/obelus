import type { PaperEditRow, Repository } from "@obelus/repo";
import { useCallback, useEffect, useState } from "react";

export interface PaperEditsData {
  live: PaperEditRow[];
  tombstoned: PaperEditRow[];
  head: PaperEditRow | undefined;
  // Current open draft id. Equals head by default. When the user "opens" a
  // past draft, the working tree is the bytes of that draft.
  currentDraftId: string | undefined;
  refresh(): Promise<void>;
  setCurrentDraftId(id: string): Promise<void>;
}

const CURRENT_KEY = (projectId: string) => `project.${projectId}.currentDraftId`;

export function usePaperEdits(repo: Repository, projectId: string): PaperEditsData {
  const [all, setAll] = useState<PaperEditRow[]>([]);
  const [currentDraftId, setCurrentDraftIdState] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    const [edits, persisted] = await Promise.all([
      repo.paperEdits.listForProject(projectId, { includeTombstoned: true }),
      repo.settings.get<string>(CURRENT_KEY(projectId)),
    ]);
    setAll(edits);
    const live = edits.filter((e) => e.state === "live");
    const head = computeHead(live);
    const fallback = head?.id;
    const resolved = persisted && live.some((e) => e.id === persisted) ? persisted : fallback;
    setCurrentDraftIdState(resolved);
  }, [repo, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const setCurrentDraftId = useCallback(
    async (id: string) => {
      await repo.settings.set(CURRENT_KEY(projectId), id);
      setCurrentDraftIdState(id);
    },
    [repo, projectId],
  );

  const live = all.filter((e) => e.state === "live");
  const tombstoned = all.filter((e) => e.state === "tombstoned");
  const head = computeHead(live);

  return {
    live,
    tombstoned,
    head,
    currentDraftId,
    refresh: load,
    setCurrentDraftId,
  };
}

// Head = the unique live edit with no live child. If the DB is empty returns
// undefined; callers render the empty state.
export function computeHead(live: ReadonlyArray<PaperEditRow>): PaperEditRow | undefined {
  const parentIds = new Set(
    live.map((e) => e.parentEditId).filter((id): id is string => id !== null),
  );
  let best: PaperEditRow | undefined;
  for (const e of live) {
    if (parentIds.has(e.id)) continue;
    if (!best || e.ordinal > best.ordinal) best = e;
  }
  return best;
}

// Descendants of `editId` in the live set, oldest-first (parent-to-child).
export function descendantsOf(live: ReadonlyArray<PaperEditRow>, editId: string): PaperEditRow[] {
  const byParent = new Map<string, PaperEditRow[]>();
  for (const e of live) {
    if (e.parentEditId === null) continue;
    const list = byParent.get(e.parentEditId) ?? [];
    list.push(e);
    byParent.set(e.parentEditId, list);
  }
  const out: PaperEditRow[] = [];
  const frontier: string[] = [editId];
  while (frontier.length > 0) {
    const id = frontier.shift();
    if (!id) break;
    for (const child of byParent.get(id) ?? []) {
      out.push(child);
      frontier.push(child.id);
    }
  }
  out.sort((a, b) => a.ordinal - b.ordinal);
  return out;
}
