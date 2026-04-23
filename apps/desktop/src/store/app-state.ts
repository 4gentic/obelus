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
  | "currentDeskId";

interface StoreShape {
  windowGeometry: WindowGeometry;
  wizard: WizardCheckpoint;
  claudeDetectCache: ClaudeDetectCache;
  lastOpenedProjectId: string | null;
  currentDeskId: string;
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
