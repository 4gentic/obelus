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

type StoreKey =
  | "windowGeometry"
  | "wizard"
  | "claudeDetectCache"
  | "lastOpenedProjectId"
  | "currentDeskId"
  | "trustedPapers";

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
