import { useEffect, useSyncExternalStore } from "react";
import { type AiEngineStatus, readAiEngineStatus } from "../lib/ai-engine";

type State = AiEngineStatus | "checking";

let current: State = "checking";
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): State {
  return current;
}

async function refresh(force: boolean): Promise<void> {
  current = "checking";
  emit();
  const next = await readAiEngineStatus(force);
  current = next;
  emit();
}

function ensureLoaded(): void {
  if (current !== "checking" || inflight !== null) return;
  inflight = refresh(false).finally(() => {
    inflight = null;
  });
}

export interface UseAiEngineResult {
  status: State;
  recheck: () => Promise<void>;
}

// Single source of truth for the engine status across the app. Consumers
// subscribe to a module-scope store so multiple components share one in-flight
// detection per app lifetime; recheck() forces a fresh probe (used by the
// wizard's "Check again" button and Settings).
export function useAiEngine(): UseAiEngineResult {
  const status = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    ensureLoaded();
  }, []);
  return {
    status,
    recheck: async () => {
      await refresh(true);
    },
  };
}

// External update path used when something outside React needs to bust the
// cache (e.g. settings panel after a manual install).
export async function refreshAiEngineStatus(): Promise<AiEngineStatus> {
  await refresh(true);
  if (current === "checking") {
    // Should be unreachable: refresh sets a non-"checking" value before
    // returning. Fallback ensures a typed return.
    return await readAiEngineStatus(true);
  }
  return current;
}
