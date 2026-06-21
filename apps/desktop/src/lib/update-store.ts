import { create, type StoreApi, type UseBoundStore } from "zustand";
import type { UpdaterState } from "./updater";

// Process-scoped state for the proactive update banner: the scheduler in
// auto-update.ts writes `available`, the banner reads it. The persisted
// preferences (consent, last-checked, dismissed version) live in app-state and
// are mirrored here so the banner and the Settings toggle re-render off one
// source instead of each caching its own copy that drifts on a mid-session
// change.

export interface AvailableUpdate {
  version: string;
  notes: string | null;
}

// "loading" until the persisted opt-in is read; "undecided" while the one-time
// consent banner is still eligible; boolean once the user has chosen.
export type ConsentState = "loading" | "undecided" | boolean;

export interface UpdateState {
  consent: ConsentState;
  available: AvailableUpdate | null;
  // Non-null only while a user-started install is in flight or has just failed;
  // drives the banner's progress / error line.
  install: UpdaterState | null;
  dismissedVersion: string | null;
  lastCheckedAt: number | null;
  setConsent(value: ConsentState): void;
  setAvailable(update: AvailableUpdate): void;
  clearAvailable(): void;
  setInstall(state: UpdaterState | null): void;
  setDismissed(version: string): void;
  setLastCheckedAt(at: number): void;
}

export type UpdateStore = UseBoundStore<StoreApi<UpdateState>>;

export const useUpdateStore: UpdateStore = create<UpdateState>()((set) => ({
  consent: "loading",
  available: null,
  install: null,
  dismissedVersion: null,
  lastCheckedAt: null,

  setConsent(value) {
    set({ consent: value });
  },

  setAvailable(update) {
    // A new version invalidates any install state from a prior offer, so the
    // banner can't show one version's failed-download error against another.
    // A re-offer of the same version keeps an in-flight download untouched.
    set((state) =>
      state.available?.version === update.version
        ? { available: update }
        : { available: update, install: null },
    );
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

  setLastCheckedAt(at) {
    set({ lastCheckedAt: at });
  },
}));
