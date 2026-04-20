import { getDb } from "./schema";

const PERSIST_KEY = "storagePersistGranted";

export async function requestPersistOnce(): Promise<boolean> {
  const db = getDb();
  const existing = await db.settings.get(PERSIST_KEY);
  if (existing && existing.value === true) return true;
  if (!("storage" in navigator) || !navigator.storage.persist) return false;
  const granted = await navigator.storage.persist();
  await db.settings.put({ key: PERSIST_KEY, value: granted });
  return granted;
}

export async function isPersisted(): Promise<boolean> {
  if (!("storage" in navigator) || !navigator.storage.persisted) return false;
  return navigator.storage.persisted();
}

export interface QuotaEstimate {
  used: number;
  quota: number;
}

export async function estimateQuota(): Promise<QuotaEstimate> {
  if (!("storage" in navigator) || !navigator.storage.estimate) {
    return { used: 0, quota: 0 };
  }
  const { usage, quota } = await navigator.storage.estimate();
  return { used: usage ?? 0, quota: quota ?? 0 };
}
