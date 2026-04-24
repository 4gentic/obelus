import type { BuffersStore } from "../../lib/buffers-store";

// Only one project is mounted at a time, so a module-level handle to the
// project's buffers store is safe. Used by jobs-listener (which lives outside
// the BuffersStoreProvider scope) to refresh open source buffers from disk
// after a Claude session touches files — without plumbing another context
// through the app root.
let active: BuffersStore | null = null;

export function setActiveBuffersStore(store: BuffersStore | null): void {
  active = store;
}

export function getActiveBuffersStore(): BuffersStore | null {
  return active;
}
