import { useCallback, useEffect, useSyncExternalStore } from "react";
import { type ClaudeUserSettings, readClaudeUserSettings } from "../ipc/commands";
import { getRepository } from "./repo";

export type ClaudeModelChoice = null | "opus" | "sonnet" | "haiku";
export type ClaudeEffortChoice = null | "low" | "medium" | "high" | "xhigh" | "max";

export const MODEL_CHOICES: ReadonlyArray<Exclude<ClaudeModelChoice, null>> = [
  "opus",
  "sonnet",
  "haiku",
];

export const EFFORT_CHOICES: ReadonlyArray<Exclude<ClaudeEffortChoice, null>> = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

const SETTING_MODEL_KEY = "claude.model";
const SETTING_EFFORT_KEY = "claude.effort";

interface ClaudeConfigSnapshot {
  defaults: ClaudeUserSettings | null;
  model: ClaudeModelChoice;
  effort: ClaudeEffortChoice;
  loaded: boolean;
}

const INITIAL: ClaudeConfigSnapshot = {
  defaults: null,
  model: null,
  effort: null,
  loaded: false,
};

let snapshot: ClaudeConfigSnapshot = INITIAL;
const listeners = new Set<() => void>();
let hydrated = false;
let hydratePromise: Promise<void> | null = null;

function emit(): void {
  for (const l of listeners) l();
}

function update(patch: Partial<ClaudeConfigSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  emit();
}

function normalizeModel(value: unknown): ClaudeModelChoice {
  if (typeof value !== "string") return null;
  if (value === "opus" || value === "sonnet" || value === "haiku") return value;
  return null;
}

function normalizeEffort(value: unknown): ClaudeEffortChoice {
  if (typeof value !== "string") return null;
  if (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
  ) {
    return value;
  }
  return null;
}

async function hydrate(): Promise<void> {
  const [defaults, repo] = await Promise.all([
    readClaudeUserSettings().catch(() => ({ model: null, effortLevel: null })),
    getRepository(),
  ]);
  const [model, effort] = await Promise.all([
    repo.settings.get<unknown>(SETTING_MODEL_KEY),
    repo.settings.get<unknown>(SETTING_EFFORT_KEY),
  ]);
  update({
    defaults,
    model: normalizeModel(model),
    effort: normalizeEffort(effort),
    loaded: true,
  });
}

async function refreshDefaults(): Promise<void> {
  try {
    const defaults = await readClaudeUserSettings();
    update({ defaults });
  } catch {
    // keep existing defaults
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (!hydrated) {
    hydrated = true;
    hydratePromise = hydrate();
  }
  return () => listeners.delete(cb);
}

function getSnapshot(): ClaudeConfigSnapshot {
  return snapshot;
}

export interface ClaudeConfig {
  readonly defaults: ClaudeUserSettings | null;
  readonly model: ClaudeModelChoice;
  readonly effort: ClaudeEffortChoice;
  readonly loaded: boolean;
  readonly resolvedModel: string | null;
  readonly resolvedEffort: string | null;
  setModel(value: ClaudeModelChoice): Promise<void>;
  setEffort(value: ClaudeEffortChoice): Promise<void>;
  refreshDefaults(): Promise<void>;
}

export function useClaudeConfig(): ClaudeConfig {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    function onFocus(): void {
      void refreshDefaults();
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const setModel = useCallback(async (value: ClaudeModelChoice): Promise<void> => {
    const repo = await getRepository();
    if (value === null) {
      await repo.settings.set<ClaudeModelChoice>(SETTING_MODEL_KEY, null);
    } else {
      await repo.settings.set<ClaudeModelChoice>(SETTING_MODEL_KEY, value);
    }
    update({ model: value });
  }, []);

  const setEffort = useCallback(async (value: ClaudeEffortChoice): Promise<void> => {
    const repo = await getRepository();
    if (value === null) {
      await repo.settings.set<ClaudeEffortChoice>(SETTING_EFFORT_KEY, null);
    } else {
      await repo.settings.set<ClaudeEffortChoice>(SETTING_EFFORT_KEY, value);
    }
    update({ effort: value });
  }, []);

  const resolvedModel = snap.model ?? snap.defaults?.model ?? null;
  const resolvedEffort = snap.effort ?? snap.defaults?.effortLevel ?? null;

  return {
    defaults: snap.defaults,
    model: snap.model,
    effort: snap.effort,
    loaded: snap.loaded,
    resolvedModel,
    resolvedEffort,
    setModel,
    setEffort,
    refreshDefaults,
  };
}

// Used by review-runner / writeup-store when spawning Claude — returns the
// overrides only (no defaults), so passing `null` lets Claude Code use its own
// configured default.
export async function loadClaudeOverrides(): Promise<{
  model: string | null;
  effort: string | null;
}> {
  if (!hydrated) {
    hydrated = true;
    hydratePromise = hydrate();
  }
  if (hydratePromise) await hydratePromise;
  return {
    model: snapshot.model,
    effort: snapshot.effort,
  };
}
