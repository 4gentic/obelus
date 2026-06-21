import { create, type StoreApi, type UseBoundStore } from "zustand";
import type { UpdaterState } from "./updater";

// Process-scoped state for the proactive update banner: the scheduler in
// auto-update.ts writes `available`, the banner reads it. The persisted half
// (consent, last-checked, dismissed version) lives in app-state.

export interface AvailableUpdate {
  version: string;
  notes: string | null;
}

export interface UpdateState {
  available: AvailableUpdate | null;
  // Non-null only while a user-started install is in flight or has just failed;
  // drives the banner's progress / error line.
  install: UpdaterState | null;
  dismissedVersion: string | null;
  setAvailable(update: AvailableUpdate): void;
  clearAvailable(): void;
  setInstall(state: UpdaterState | null): void;
  setDismissed(version: string): void;
}

export type UpdateStore = UseBoundStore<StoreApi<UpdateState>>;

export const useUpdateStore: UpdateStore = create<UpdateState>()((set) => ({
  available: null,
  install: null,
  dismissedVersion: null,

  setAvailable(update) {
    set({ available: update });
  },

  clearAvailable() {
    set({ available: null });
  },

  setInstall(state) {
    set({ install: state });
  },

  setDismissed(version) {
    set({ dismissedVersion: version });
  },
}));
