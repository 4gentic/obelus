import type { PaperEditRow, Repository } from "@obelus/repo";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { create, type StoreApi, type UseBoundStore } from "zustand";
import { z } from "zod";

const CurrentDraftIdSchema = z.string();

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

const CURRENT_KEY = (paperId: string) => `paper.${paperId}.currentDraftId`;

// Single source of truth per paper. Mounting a second `usePaperEdits` with the
// same paperId subscribes to the same store, so `setCurrentDraftId` in one
// caller fans out to every subscriber.
//
// The Maps are module-global so the store outlives unmounted components, but
// we cap them at MAX_CACHED_PAPERS and evict in insertion order. A re-opened
// paper just re-loads from the repo — cheap and correct.
const MAX_CACHED_PAPERS = 32;
const stores = new Map<string, PaperEditsStore>();
const loaders = new Map<string, () => Promise<void>>();

const EMPTY_DATA: PaperEditsData = {
  live: [],
  tombstoned: [],
  head: undefined,
  currentDraftId: undefined,
  refresh: () => Promise.resolve(),
  setCurrentDraftId: () => Promise.resolve(),
};

function getStore(repo: Repository, paperId: string): PaperEditsStore {
  const existing = stores.get(paperId);
  if (existing) return existing;
  while (stores.size >= MAX_CACHED_PAPERS) {
    const oldest = stores.keys().next().value;
    if (oldest === undefined) break;
    stores.delete(oldest);
    loaders.delete(oldest);
  }
  const store = create<PaperEditsStoreState>((set) => ({
    all: [],
    currentDraftId: undefined,
    _set: (patch) => set(patch),
  }));
  stores.set(paperId, store);
  const load = async (): Promise<void> => {
    const [edits, persisted] = await Promise.all([
      repo.paperEdits.listForPaper(paperId, { includeTombstoned: true }),
      repo.settings.get(CURRENT_KEY(paperId), CurrentDraftIdSchema),
    ]);
    const live = edits.filter((e) => e.state === "live");
    const head = computeHead(live);
    const fallback = head?.id;
    const resolved = persisted && live.some((e) => e.id === persisted) ? persisted : fallback;
    store.getState()._set({ all: edits, currentDraftId: resolved });
  };
  loaders.set(paperId, load);
  void load();
  return store;
}

export function usePaperEdits(repo: Repository, paperId: string | null): PaperEditsData {
  // When no paper is open, return an inert stable object. Callers render the
  // "open a paper" empty state rather than wiring conditional hooks.
  const store = paperId ? getStore(repo, paperId) : null;
  const all = useSyncExternalStore(
    (cb) => store?.subscribe(cb) ?? (() => {}),
    () => store?.getState().all ?? EMPTY_DATA.live,
    () => store?.getState().all ?? EMPTY_DATA.live,
  );
  const currentDraftId = useSyncExternalStore(
    (cb) => store?.subscribe(cb) ?? (() => {}),
    () => store?.getState().currentDraftId,
    () => store?.getState().currentDraftId,
  );

  const refresh = useCallback(async (): Promise<void> => {
    if (!paperId) return;
    const load = loaders.get(paperId);
    if (load) await load();
  }, [paperId]);
  const setCurrentDraftId = useCallback(
    async (id: string): Promise<void> => {
      if (!paperId || !store) return;
      await repo.settings.set(CURRENT_KEY(paperId), id);
      store.getState()._set({ currentDraftId: id });
    },
    [repo, paperId, store],
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
