import { useEffect } from "react";
import {
  getAutoUpdateCheck,
  getDismissedUpdateVersion,
  getLastUpdateCheckAt,
  setLastUpdateCheckAt,
} from "../store/app-state";
import { useUpdateStore } from "./update-store";
import { checkForUpdate } from "./updater";

const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
// On launch, re-check unless we checked within this window. Tauri reloads the
// WebView (after an install, or a dev refresh) without restarting the process,
// which re-mounts React; the floor stops that from firing a redundant check.
const OPEN_FLOOR_MS = 5 * 60 * 1000;
const HEARTBEAT_MS = 10 * 60 * 1000;

export async function runAutoUpdateCheck(): Promise<void> {
  const result = await checkForUpdate();
  await setLastUpdateCheckAt(Date.now());
  const store = useUpdateStore.getState();
  if (result.kind === "available") {
    store.setAvailable({ version: result.version, notes: result.notes });
  } else {
    store.clearAvailable();
  }
}

let scheduledInFlight = false;

// Reads the persisted opt-in on every call so a mid-session toggle (or the
// banner's "Enable") takes effect on the next heartbeat without remounting.
// The in-flight guard keeps a focus event and the heartbeat from firing two
// overlapping checks when they coincide near the 8h boundary.
async function maybeCheck(minSinceLastMs: number): Promise<void> {
  if (scheduledInFlight) return;
  if ((await getAutoUpdateCheck()) !== true) return;
  const last = await getLastUpdateCheckAt();
  if (last !== undefined && Date.now() - last < minSinceLastMs) return;
  scheduledInFlight = true;
  try {
    await runAutoUpdateCheck();
  } finally {
    scheduledInFlight = false;
  }
}

export function useAutoUpdate(): void {
  useEffect(() => {
    void getDismissedUpdateVersion().then((v) => {
      if (v) useUpdateStore.getState().setDismissed(v);
    });

    void maybeCheck(OPEN_FLOOR_MS);

    const heartbeat = setInterval(() => {
      void maybeCheck(EIGHT_HOURS_MS);
    }, HEARTBEAT_MS);

    // A focus / tab-visible transition is the cheapest signal that the machine
    // woke from sleep, where setInterval can't be trusted to have fired.
    const onWake = (): void => {
      if (document.visibilityState === "visible") void maybeCheck(EIGHT_HOURS_MS);
    };
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);

    return () => {
      clearInterval(heartbeat);
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, []);
}
