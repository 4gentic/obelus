import { Store } from "@tauri-apps/plugin-store";
import type { ClaudeStatus } from "../ipc/commands";

const STORE_PATH = "app-state.json";

export interface WindowGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ClaudeDetectCache {
  status: ClaudeStatus;
  checkedAt: string;
}

export interface WizardCheckpoint {
  folio: 1 | 2 | 3 | 4 | "done";
  seenOnce: boolean;
}

// Per-spawn dispatch override for the start-review panel's Advanced
// disclosure. Kept narrow so a future picker that ships more values doesn't
// silently widen the persisted shape: the read path validates against the
// allow-list before handing the value to the runner.
export type StoredReviewModel = "sonnet" | "opus" | "haiku";
export type StoredReviewEffort = "low" | "medium" | "high";

export interface ReviewDispatchPick {
  model: StoredReviewModel;
  effort: StoredReviewEffort;
}

const REVIEW_MODEL_VALUES: ReadonlyArray<StoredReviewModel> = ["sonnet", "opus", "haiku"];
const REVIEW_EFFORT_VALUES: ReadonlyArray<StoredReviewEffort> = ["low", "medium", "high"];

type StoreKey =
  | "windowGeometry"
  | "wizard"
  | "claudeDetectCache"
  | "lastOpenedProjectId"
  | "currentDeskId"
  | "trustedPapers"
  | "reviewDispatchPick";

interface StoreShape {
  windowGeometry: WindowGeometry;
  wizard: WizardCheckpoint;
  claudeDetectCache: ClaudeDetectCache;
  lastOpenedProjectId: string | null;
  currentDeskId: string;
  // Per-paper external-resource trust. Keys are paper IDs (the repo's
  // primary key); presence means "user said this paper's external
  // requests are safe to load". The map shape is preserved so a future
  // migration can attach metadata (granted-at, host allow-list) without
  // churning the storage key.
  trustedPapers: Record<string, true>;
  // Cross-session model + effort the start-review panel's Advanced
  // disclosure last set. Read on mount, written on change.
  reviewDispatchPick: ReviewDispatchPick;
}

let singleton: Promise<Store> | null = null;

function store(): Promise<Store> {
  if (!singleton) {
    singleton = Store.load(STORE_PATH);
  }
  return singleton;
}

export async function getAppState<K extends StoreKey>(key: K): Promise<StoreShape[K] | undefined> {
  const s = await store();
  const v = await s.get<StoreShape[K]>(key);
  return v ?? undefined;
}

export async function setAppState<K extends StoreKey>(key: K, value: StoreShape[K]): Promise<void> {
  const s = await store();
  await s.set(key, value);
  await s.save();
}

export async function clearAppState(): Promise<void> {
  const s = await store();
  await s.clear();
  await s.save();
}

export async function isPaperTrusted(paperId: string): Promise<boolean> {
  const map = await getAppState("trustedPapers");
  return map?.[paperId] === true;
}

export async function trustPaper(paperId: string): Promise<void> {
  const existing = (await getAppState("trustedPapers")) ?? {};
  if (existing[paperId] === true) return;
  await setAppState("trustedPapers", { ...existing, [paperId]: true });
}

export async function untrustPaper(paperId: string): Promise<void> {
  const existing = await getAppState("trustedPapers");
  if (!existing || existing[paperId] !== true) return;
  const next: Record<string, true> = { ...existing };
  delete next[paperId];
  await setAppState("trustedPapers", next);
}

export async function untrustPapers(paperIds: ReadonlyArray<string>): Promise<void> {
  if (paperIds.length === 0) return;
  const existing = await getAppState("trustedPapers");
  if (!existing) return;
  const next: Record<string, true> = { ...existing };
  let changed = false;
  for (const id of paperIds) {
    if (next[id] === true) {
      delete next[id];
      changed = true;
    }
  }
  if (!changed) return;
  await setAppState("trustedPapers", next);
}

// Coerce a persisted reviewDispatchPick to its narrow shape. A user (or a
// rogue migration) could land arbitrary text in app-state.json; reads
// validate before handing the value to the runner so an invalid persisted
// pick falls back to the default rather than reaching the Tauri boundary.
function isStoredModel(value: unknown): value is StoredReviewModel {
  return (
    typeof value === "string" && (REVIEW_MODEL_VALUES as ReadonlyArray<string>).includes(value)
  );
}
function isStoredEffort(value: unknown): value is StoredReviewEffort {
  return (
    typeof value === "string" && (REVIEW_EFFORT_VALUES as ReadonlyArray<string>).includes(value)
  );
}

export async function getReviewDispatchPick(): Promise<ReviewDispatchPick | undefined> {
  const raw = await getAppState("reviewDispatchPick");
  if (!raw) return undefined;
  const candidate = raw as { model?: unknown; effort?: unknown };
  if (!isStoredModel(candidate.model) || !isStoredEffort(candidate.effort)) {
    return undefined;
  }
  return { model: candidate.model, effort: candidate.effort };
}

export async function setReviewDispatchPick(pick: ReviewDispatchPick): Promise<void> {
  await setAppState("reviewDispatchPick", pick);
}
