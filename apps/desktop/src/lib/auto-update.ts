import { useEffect } from "react";
import {
  getAutoUpdateCheck,
  getDismissedUpdateVersion,
  getLastUpdateCheckAt,
  setAutoUpdateCheck,
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

// Pure gate for the proactive cadence: never without opt-in, and not again
// until `minSinceLastMs` has elapsed since the last completed check.
export function shouldCheck(
  consent: boolean | undefined,
  lastCheckedAt: number | undefined,
  now: number,
  minSinceLastMs: number,
): boolean {
  if (consent !== true) return false;
  if (lastCheckedAt !== undefined && now - lastCheckedAt < minSinceLastMs) return false;
  return true;
}

// Persists a completed check's timestamp and mirrors it into the store so the
// Settings "Last checked" line updates without a reload.
export async function recordUpdateCheck(): Promise<void> {
  const now = Date.now();
  useUpdateStore.getState().setLastCheckedAt(now);
  await setLastUpdateCheckAt(now);
}

// Persists the consent choice and mirrors it into the store so the banner and
// the Settings toggle reflect a change made in the other.
export async function setAutoUpdateConsent(value: boolean): Promise<void> {
  useUpdateStore.getState().setConsent(value);
  await setAutoUpdateCheck(value);
}

async function performCheck(): Promise<void> {
  const result = await checkForUpdate();
  await recordUpdateCheck();
  const store = useUpdateStore.getState();
  if (result.kind === "available") {
    store.setAvailable({ version: result.version, notes: result.notes });
  } else {
    store.clearAvailable();
  }
}

// The single in-flight guard for every check, automatic or direct. A focus
// event, the heartbeat, the banner's "Enable", and the Settings toggle all
// funnel through here, so two can't fire overlapping checks when they coincide.
let scheduledInFlight = false;

export async function runAutoUpdateCheck(): Promise<void> {
  if (scheduledInFlight) return;
  scheduledInFlight = true;
  try {
    await performCheck();
  } finally {
    scheduledInFlight = false;
  }
}

// Reads the persisted opt-in on every call so a mid-session toggle (or the
// banner's "Enable") takes effect on the next heartbeat without remounting.
async function maybeCheck(minSinceLastMs: number): Promise<void> {
  const consent = await getAutoUpdateCheck();
  const last = await getLastUpdateCheckAt();
  if (!shouldCheck(consent, last, Date.now(), minSinceLastMs)) return;
  await runAutoUpdateCheck();
}

// Mirrors the persisted preferences into the store. Awaited before the first
// check so the banner knows the dismissed version before `available` can be set
// — otherwise a just-dismissed version could flash in the window where the
// network check beats the local read.
async function loadPreferences(): Promise<void> {
  const [consent, dismissed, last] = await Promise.all([
    getAutoUpdateCheck(),
    getDismissedUpdateVersion(),
    getLastUpdateCheckAt(),
  ]);
  const store = useUpdateStore.getState();
  store.setConsent(consent === undefined ? "undecided" : consent);
  if (dismissed) store.setDismissed(dismissed);
  if (last !== undefined) store.setLastCheckedAt(last);
}

export function useAutoUpdate(): void {
  useEffect(() => {
    void loadPreferences().then(() => maybeCheck(OPEN_FLOOR_MS));

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
