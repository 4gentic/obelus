import { useCallback, useSyncExternalStore } from "react";
import { getSourceSplit, type SourceSplitPrefs, setSourceSplit } from "../../store/app-state";

const MIN_RATIO = 0.2;
const MAX_RATIO = 0.8;

export function clampSplitRatio(ratio: number): number {
  if (Number.isNaN(ratio)) return 0.5;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
}

const DEFAULTS: SourceSplitPrefs = { showSource: false, splitRatio: 0.5 };

// Module-level cache so reads are synchronous after the first hydration and
// survive `CenterPane` remounts (a file switch) without flashing the default —
// the failure mode of the `useState`+async pattern. Mirrors `layout-store`'s
// Map + `useSyncExternalStore`, with a lazy app-state read layered on top.
const cache = new Map<string, SourceSplitPrefs>();
const listenersByProject = new Map<string, Set<() => void>>();
const hydrationStarted = new Set<string>();

function notify(projectId: string): void {
  const set = listenersByProject.get(projectId);
  if (!set) return;
  for (const cb of set) cb();
}

function ensureHydrated(projectId: string): void {
  if (hydrationStarted.has(projectId)) return;
  hydrationStarted.add(projectId);
  void getSourceSplit(projectId).then((prefs) => {
    // A setter that fired before this read resolved is the fresher source of
    // truth (it wrote through to app-state); leave its value in place.
    if (cache.has(projectId)) return;
    cache.set(projectId, {
      showSource: prefs.showSource,
      splitRatio: clampSplitRatio(prefs.splitRatio),
    });
    notify(projectId);
  });
}

function getSnapshot(projectId: string): SourceSplitPrefs {
  return cache.get(projectId) ?? DEFAULTS;
}

function write(projectId: string, next: SourceSplitPrefs): void {
  // A setter is now authoritative for this project; suppress a late hydration
  // from clobbering the optimistic value.
  hydrationStarted.add(projectId);
  cache.set(projectId, next);
  notify(projectId);
  void setSourceSplit(projectId, next);
}

export function setShowSource(projectId: string, on: boolean): void {
  const prev = cache.get(projectId) ?? DEFAULTS;
  if (prev.showSource === on) return;
  write(projectId, { ...prev, showSource: on });
}

export function setSplitRatio(projectId: string, ratio: number): void {
  const prev = cache.get(projectId) ?? DEFAULTS;
  const splitRatio = clampSplitRatio(ratio);
  if (prev.splitRatio === splitRatio) return;
  write(projectId, { ...prev, splitRatio });
}

export function useSourceSplit(projectId: string): SourceSplitPrefs {
  const subscribe = useCallback(
    (cb: () => void) => {
      let set = listenersByProject.get(projectId);
      if (!set) {
        set = new Set();
        listenersByProject.set(projectId, set);
      }
      set.add(cb);
      ensureHydrated(projectId);
      return () => {
        set?.delete(cb);
      };
    },
    [projectId],
  );
  const snapshot = useCallback(() => getSnapshot(projectId), [projectId]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
