import { Store } from "@tauri-apps/plugin-store";
import type { ClaudeStatus } from "../ipc/commands";
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

export interface WizardCheckpoint {
  folio: 1 | 2 | 3 | 4 | "done";
  seenOnce: boolean;
}

const REVIEWER_THOROUGHNESS_VALUES: ReadonlyArray<ReviewerThoroughness> = ["normal", "deep"];

type StoreKey =
  | "windowGeometry"
  | "wizard"
  | "claudeDetectCache"
  | "lastOpenedProjectId"
  | "currentDeskId"
  | "trustedPapers"
  | "reviewerThoroughness"
  | "panelsByProject";

export interface ProjectPanelState {
  filesHidden: boolean;
  reviewHidden: boolean;
}

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
  // Cross-session reviewer thoroughness ("normal" or "deep"). Read on mount,
  // written on toggle. The runner maps this to {model, effort} via
  // THOROUGHNESS_SPAWN at spawn time.
  reviewerThoroughness: ReviewerThoroughness;
  // Per-project panel visibility (files column on the left, review column on
  // the right). Absent entry → both panels visible (the default). Persisted
  // so users who hide a panel keep it hidden across restarts.
  panelsByProject: Record<string, ProjectPanelState>;
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

export async function getProjectPanelState(
  projectId: string,
): Promise<ProjectPanelState | undefined> {
  const map = await getAppState("panelsByProject");
  return map?.[projectId];
}

export async function setProjectPanelHidden(
  projectId: string,
  side: "files" | "review",
  hidden: boolean,
): Promise<void> {
  const existing = (await getAppState("panelsByProject")) ?? {};
  const current = existing[projectId] ?? { filesHidden: false, reviewHidden: false };
  const next: ProjectPanelState =
    side === "files"
      ? { filesHidden: hidden, reviewHidden: current.reviewHidden }
      : { filesHidden: current.filesHidden, reviewHidden: hidden };
  if (next.filesHidden === current.filesHidden && next.reviewHidden === current.reviewHidden) {
    return;
  }
  await setAppState("panelsByProject", { ...existing, [projectId]: next });
}
