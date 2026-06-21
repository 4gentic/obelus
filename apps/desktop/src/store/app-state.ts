import { Store } from "@tauri-apps/plugin-store";
import type { ClaudeStatus, OpenCodeStatus } from "../ipc/commands";
import type { AiEngineId } from "../lib/ai-engine";
import type { ReviewerThoroughness } from "../lib/reviewer-thoroughness";

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

export interface OpenCodeDetectCache {
  status: OpenCodeStatus;
  checkedAt: string;
}

export interface WizardCheckpoint {
  folio: 1 | 2 | 3 | 4 | "done";
  seenOnce: boolean;
}

const REVIEWER_THOROUGHNESS_VALUES: ReadonlyArray<ReviewerThoroughness> = ["normal", "deep"];

type StoreKey =
  | "windowGeometry"
  | "wizard"
  | "claudeDetectCache"
  | "openCodeDetectCache"
  | "preferredAiEngine"
  | "lastOpenedProjectId"
  | "currentDeskId"
  | "trustedPapers"
  | "reviewerThoroughness"
  | "panelsByProject"
  | "autoUpdateCheck"
  | "lastUpdateCheckAt"
  | "dismissedUpdateVersion";

export interface ProjectPanelState {
  filesHidden: boolean;
  reviewHidden: boolean;
  // Review-focus expands the review column over the document so the diff and
  // the review console get a legible reading width. A wide-screen affordance,
  // persisted so it survives a restart like the hide flags.
  reviewFocused: boolean;
}

interface StoreShape {
  windowGeometry: WindowGeometry;
  wizard: WizardCheckpoint;
  claudeDetectCache: ClaudeDetectCache;
  openCodeDetectCache: OpenCodeDetectCache;
  // The engine spawn calls go through. Null until the user has either picked
  // one in Settings or only one engine has been detected ready (in which case
  // the wizard auto-selects it). Spawn falls back to whichever engine is
  // ready when this is null.
  preferredAiEngine: AiEngineId;
  lastOpenedProjectId: string | null;
  currentDeskId: string;
  // Per-paper external-resource trust. Keys are paper IDs (the repo's
  // primary key); presence means "user said this paper's external
  // requests are safe to load". The map shape is preserved so a future
  // migration can attach metadata (granted-at, host allow-list) without
  // churning the storage key.
  trustedPapers: Record<string, true>;
  // Cross-session reviewer thoroughness ("normal" or "deep"). Read on mount,
  // written on toggle. The runner maps this to {model, effort} via
  // THOROUGHNESS_SPAWN at spawn time.
  reviewerThoroughness: ReviewerThoroughness;
  // Per-project panel visibility (files column on the left, review column on
  // the right) plus the review-focus flag. Absent entry → both panels visible,
  // not focused (the default). Persisted so users keep their layout across
  // restarts.
  panelsByProject: Record<string, ProjectPanelState>;
  // Consent for proactive update checks. Absent = the user hasn't decided yet
  // (the one-time consent banner is still eligible); true/false = decided.
  // Off unless opted in, so the offline-first promise holds by default.
  autoUpdateCheck: boolean;
  // Epoch ms of the last completed update check. Drives the 8h re-check cadence
  // and a short floor that dedupes WebView refreshes; surfaced in Settings.
  lastUpdateCheckAt: number;
  // Version the user dismissed in the update banner. The banner stays hidden
  // until a different (newer) version is offered.
  dismissedUpdateVersion: string;
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

function isReviewerThoroughness(value: unknown): value is ReviewerThoroughness {
  return (
    typeof value === "string" &&
    (REVIEWER_THOROUGHNESS_VALUES as ReadonlyArray<string>).includes(value)
  );
}

export async function getReviewerThoroughness(): Promise<ReviewerThoroughness | undefined> {
  const raw = await getAppState("reviewerThoroughness");
  if (!isReviewerThoroughness(raw)) return undefined;
  return raw;
}

export async function setReviewerThoroughness(value: ReviewerThoroughness): Promise<void> {
  await setAppState("reviewerThoroughness", value);
}

const DEFAULT_PANEL_STATE: ProjectPanelState = {
  filesHidden: false,
  reviewHidden: false,
  reviewFocused: false,
};

export async function getProjectPanelState(
  projectId: string,
): Promise<ProjectPanelState | undefined> {
  const stored = (await getAppState("panelsByProject"))?.[projectId];
  // `reviewFocused` post-dates the first ship of this key; entries written
  // before it default to not-focused.
  return stored ? { ...DEFAULT_PANEL_STATE, ...stored } : undefined;
}

export async function setProjectPanelHidden(
  projectId: string,
  side: "files" | "review",
  hidden: boolean,
): Promise<void> {
  const existing = (await getAppState("panelsByProject")) ?? {};
  const current = { ...DEFAULT_PANEL_STATE, ...existing[projectId] };
  const next: ProjectPanelState =
    side === "files" ? { ...current, filesHidden: hidden } : { ...current, reviewHidden: hidden };
  if (next.filesHidden === current.filesHidden && next.reviewHidden === current.reviewHidden) {
    return;
  }
  await setAppState("panelsByProject", { ...existing, [projectId]: next });
}

export async function setProjectReviewFocused(projectId: string, focused: boolean): Promise<void> {
  const existing = (await getAppState("panelsByProject")) ?? {};
  const current = { ...DEFAULT_PANEL_STATE, ...existing[projectId] };
  if (current.reviewFocused === focused) return;
  await setAppState("panelsByProject", {
    ...existing,
    [projectId]: { ...current, reviewFocused: focused },
  });
}

export async function getAutoUpdateCheck(): Promise<boolean | undefined> {
  return getAppState("autoUpdateCheck");
}

export async function setAutoUpdateCheck(value: boolean): Promise<void> {
  await setAppState("autoUpdateCheck", value);
}

export async function getLastUpdateCheckAt(): Promise<number | undefined> {
  return getAppState("lastUpdateCheckAt");
}

export async function setLastUpdateCheckAt(value: number): Promise<void> {
  await setAppState("lastUpdateCheckAt", value);
}

export async function getDismissedUpdateVersion(): Promise<string | undefined> {
  return getAppState("dismissedUpdateVersion");
}

export async function setDismissedUpdateVersion(value: string): Promise<void> {
  await setAppState("dismissedUpdateVersion", value);
}
