import type { PaperEditRow, Repository } from "@obelus/repo";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { create, type StoreApi, type UseBoundStore } from "zustand";

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

interface PaperEditsStoreState {
  all: PaperEditRow[];
  currentDraftId: string | undefined;
  _set(patch: Partial<Pick<PaperEditsStoreState, "all" | "currentDraftId">>): void;
}

type PaperEditsStore = UseBoundStore<StoreApi<PaperEditsStoreState>>;

const CURRENT_KEY = (projectId: string) => `project.${projectId}.currentDraftId`;

// Single source of truth per project. Mounting a second `usePaperEdits` with
// the same projectId subscribes to the same store, so `setCurrentDraftId` in
// one caller fans out to every subscriber (DraftsRail, DraftsPanel, the
// annotations ancestry filter, the apply-flow fork warning, etc.).
const stores = new Map<string, PaperEditsStore>();
const loaders = new Map<string, () => Promise<void>>();

function getStore(repo: Repository, projectId: string): PaperEditsStore {
  const existing = stores.get(projectId);
  if (existing) return existing;
  const store = create<PaperEditsStoreState>((set) => ({
    all: [],
    currentDraftId: undefined,
    _set: (patch) => set(patch),
  }));
  stores.set(projectId, store);
  const load = async (): Promise<void> => {
    const [edits, persisted] = await Promise.all([
      repo.paperEdits.listForProject(projectId, { includeTombstoned: true }),
      repo.settings.get<string>(CURRENT_KEY(projectId)),
    ]);
    const live = edits.filter((e) => e.state === "live");
    const head = computeHead(live);
    const fallback = head?.id;
    const resolved = persisted && live.some((e) => e.id === persisted) ? persisted : fallback;
    store.getState()._set({ all: edits, currentDraftId: resolved });
  };
  loaders.set(projectId, load);
  void load();
  return store;
}

export function usePaperEdits(repo: Repository, projectId: string): PaperEditsData {
  const store = getStore(repo, projectId);
  const all = useSyncExternalStore(
    store.subscribe,
    () => store.getState().all,
    () => store.getState().all,
  );
  const currentDraftId = useSyncExternalStore(
    store.subscribe,
    () => store.getState().currentDraftId,
    () => store.getState().currentDraftId,
  );

  const refresh = useCallback(async (): Promise<void> => {
    const load = loaders.get(projectId);
    if (load) await load();
  }, [projectId]);
  const setCurrentDraftId = useCallback(
    async (id: string): Promise<void> => {
      await repo.settings.set(CURRENT_KEY(projectId), id);
      store.getState()._set({ currentDraftId: id });
    },
    [repo, projectId, store],
  );

  const live = useMemo(() => all.filter((e) => e.state === "live"), [all]);
  const tombstoned = useMemo(() => all.filter((e) => e.state === "tombstoned"), [all]);
  const head = useMemo(() => computeHead(live), [live]);

  return useMemo(
    () => ({ live, tombstoned, head, currentDraftId, refresh, setCurrentDraftId }),
    [live, tombstoned, head, currentDraftId, refresh, setCurrentDraftId],
  );
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
