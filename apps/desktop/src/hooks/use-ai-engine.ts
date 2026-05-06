import { useEffect, useSyncExternalStore } from "react";
import {
  type AiEngineId,
  type AiEngineStatus,
  type ClaudeCodeEngineStatus,
  type EngineGate,
  gateForEngine,
  getPreferredEngine,
  type OpenCodeEngineStatus,
  readAllEngineStatuses,
  resolveSpawnEngine,
  setPreferredEngine,
} from "../lib/ai-engine";

interface SnapshotLoading {
  loaded: false;
  claudeCode: "checking";
  openCode: "checking";
  preferred: AiEngineId | null;
}

interface SnapshotReady {
  loaded: true;
  claudeCode: ClaudeCodeEngineStatus;
  openCode: OpenCodeEngineStatus;
  preferred: AiEngineId | null;
}

type Snapshot = SnapshotLoading | SnapshotReady;

let current: Snapshot = {
  loaded: false,
  claudeCode: "checking",
  openCode: "checking",
  preferred: null,
};
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;
// Incremented each time setPreferred writes to the store. refresh() captures
// the generation before its await and, if it advanced, uses the optimistically-
// set current.preferred rather than the stale store read.
let preferredGeneration = 0;

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Snapshot {
  return current;
}

async function refresh(force: boolean): Promise<void> {
  const genAtStart = preferredGeneration;
  current = {
    loaded: false,
    claudeCode: "checking",
    openCode: "checking",
    preferred: current.preferred,
  };
  emit();
  const [statuses, preferredFromStore] = await Promise.all([
    readAllEngineStatuses(force),
    getPreferredEngine(),
  ]);
  // If setPreferred fired while we were awaiting, its optimistic write to
  // current.preferred takes precedence over the stale store read.
  const preferred = preferredGeneration === genAtStart ? preferredFromStore : current.preferred;
  current = {
    loaded: true,
    claudeCode: statuses.claudeCode,
    openCode: statuses.openCode,
    preferred,
  };
  emit();
}

function ensureLoaded(): void {
  if (current.loaded || inflight !== null) return;
  inflight = refresh(false).finally(() => {
    inflight = null;
  });
}

export interface UseAiEngineResult {
  // Per-engine status. While the first detection is in flight both fields
  // hold the literal "checking"; after that they hold the resolved status.
  // The two engines load together so the UI never shows one ready and the
  // other still spinning.
  claudeCode: ClaudeCodeEngineStatus | "checking";
  openCode: OpenCodeEngineStatus | "checking";
  // The engine the next spawn would target: the user's preferred engine if
  // ready, the only ready engine when one is missing, or null when no spawn
  // is possible (nothing installed) or when the user must pick (both ready,
  // no preference recorded).
  active: AiEngineStatus | null;
  // Drives the disabled-button copy: "checking" / "missing" / "must-pick" /
  // "ready". Components that only need "is a spawn possible?" can keep
  // gating on `active !== null`.
  gate: EngineGate;
  // The user's chosen engine. Null until they pick one, or when only one
  // engine has ever been ready (in which case the wizard auto-records it).
  preferred: AiEngineId | null;
  setPreferred: (id: AiEngineId) => Promise<void>;
  recheck: () => Promise<void>;
}

function deriveActive(snap: Snapshot): AiEngineStatus | null {
  if (!snap.loaded) return null;
  return resolveSpawnEngine(
    { claudeCode: snap.claudeCode, openCode: snap.openCode },
    snap.preferred,
  );
}

// Single source of truth for engine status across the app. Consumers
// subscribe to a module-scope store so multiple components share one
// in-flight detection per app lifetime; recheck() forces a fresh probe (used
// by the wizard's "Check again" button and Settings).
export function useAiEngine(): UseAiEngineResult {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    ensureLoaded();
  }, []);
  return {
    claudeCode: snap.claudeCode,
    openCode: snap.openCode,
    active: deriveActive(snap),
    gate: gateForEngine(snap),
    preferred: snap.preferred,
    setPreferred: async (id) => {
      preferredGeneration++;
      await setPreferredEngine(id);
      current = { ...current, preferred: id };
      emit();
    },
    recheck: async () => {
      await refresh(true);
    },
  };
}
