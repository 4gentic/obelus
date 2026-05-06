import {
  type ClaudeStatus,
  detectClaude,
  detectOpenCode,
  type HostOs,
  type OpenCodeStatus,
} from "../ipc/commands";
import { getAppState, setAppState } from "../store/app-state";

// The two engines Obelus knows how to spawn. Either is sufficient to use the
// app. Consumers gate on `isAiEngineReady(status)` and render install hints
// via `aiEngineInstallHints(engine, host)` — both helpers are engine-agnostic
// so adding a third engine later does not touch call sites.
export type AiEngineId = "claudeCode" | "openCode";

export const AI_ENGINE_IDS: ReadonlyArray<AiEngineId> = ["claudeCode", "openCode"];

export interface ClaudeCodeEngineStatus {
  engine: "claudeCode";
  ready: boolean;
  hostOs: HostOs;
  raw: ClaudeStatus;
}

export interface OpenCodeEngineStatus {
  engine: "openCode";
  ready: boolean;
  hostOs: HostOs;
  raw: OpenCodeStatus;
}

export type AiEngineStatus = ClaudeCodeEngineStatus | OpenCodeEngineStatus;

export interface InstallHint {
  label: string;
  command: string;
  preferred?: boolean;
}

const CACHE_TTL_MS = 1000 * 60 * 60 * 24;

export function aiEngineLabel(id: AiEngineId): string {
  if (id === "claudeCode") return "Claude Code";
  return "OpenCode";
}

// One-line shell command that signs the user in to the engine's preferred
// auth path. Surfaced uniformly under both engine panes — Obelus does not
// probe auth state itself.
export function aiEngineSignInHint(id: AiEngineId): string {
  if (id === "claudeCode") return "claude /login";
  return "opencode auth login";
}

export function isAiEngineReady(s: AiEngineStatus | "checking" | null): boolean {
  if (s === null || s === "checking") return false;
  return s.ready;
}

function isReadyClaudeState(state: ClaudeStatus["status"]): boolean {
  // `found`, `aboveCeiling`, `unreadable` all result in a usable spawn — the
  // wizard's existing decision. Only `notFound` and `belowFloor` block.
  return state === "found" || state === "aboveCeiling" || state === "unreadable";
}

function isReadyOpenCodeState(state: OpenCodeStatus["status"]): boolean {
  // OpenCode has no version floor. `unreadable` (couldn't read --version)
  // still proceeds — the same tolerance the Claude path takes.
  return state === "found" || state === "unreadable";
}

function toClaudeEngineStatus(raw: ClaudeStatus): ClaudeCodeEngineStatus {
  return {
    engine: "claudeCode",
    ready: isReadyClaudeState(raw.status),
    hostOs: raw.hostOs,
    raw,
  };
}

function toOpenCodeEngineStatus(raw: OpenCodeStatus): OpenCodeEngineStatus {
  return {
    engine: "openCode",
    ready: isReadyOpenCodeState(raw.status),
    hostOs: raw.hostOs,
    raw,
  };
}

export async function readClaudeStatus(force = false): Promise<ClaudeCodeEngineStatus> {
  if (!force) {
    const cached = await getAppState("claudeDetectCache");
    // `hostOs` is required for install-hint rendering; a cache entry lacking it
    // (written by a pre-HostOs build still in the 24 h window) must be rejected.
    if (cached?.status.hostOs && Date.now() - new Date(cached.checkedAt).getTime() < CACHE_TTL_MS) {
      return toClaudeEngineStatus(cached.status);
    }
  }
  const raw = await detectClaude();
  await setAppState("claudeDetectCache", {
    status: raw,
    checkedAt: new Date().toISOString(),
  });
  return toClaudeEngineStatus(raw);
}

export async function readOpenCodeStatus(force = false): Promise<OpenCodeEngineStatus> {
  if (!force) {
    const cached = await getAppState("openCodeDetectCache");
    if (cached?.status.hostOs && Date.now() - new Date(cached.checkedAt).getTime() < CACHE_TTL_MS) {
      return toOpenCodeEngineStatus(cached.status);
    }
  }
  const raw = await detectOpenCode();
  await setAppState("openCodeDetectCache", {
    status: raw,
    checkedAt: new Date().toISOString(),
  });
  return toOpenCodeEngineStatus(raw);
}

export interface AllEngineStatuses {
  claudeCode: ClaudeCodeEngineStatus;
  openCode: OpenCodeEngineStatus;
}

export async function readAllEngineStatuses(force = false): Promise<AllEngineStatuses> {
  const [claudeCode, openCode] = await Promise.all([
    readClaudeStatus(force),
    readOpenCodeStatus(force),
  ]);
  return { claudeCode, openCode };
}

export async function getPreferredEngine(): Promise<AiEngineId | null> {
  const id = await getAppState("preferredAiEngine");
  return id ?? null;
}

export async function setPreferredEngine(id: AiEngineId): Promise<void> {
  await setAppState("preferredAiEngine", id);
}

// Returns the engine the next spawn should target. The "both ready, no
// preference" case returns null so the UI can force the user to pick — there
// is no defensible default when both are installed and the user hasn't said
// which they want. The single-engine-ready cases ignore the preference (it
// might point at an engine the user just uninstalled).
export function resolveSpawnEngine(
  all: AllEngineStatuses,
  preferred: AiEngineId | null,
): AiEngineStatus | null {
  if (preferred === "claudeCode" && all.claudeCode.ready) return all.claudeCode;
  if (preferred === "openCode" && all.openCode.ready) return all.openCode;
  if (all.claudeCode.ready && all.openCode.ready) return null;
  if (all.claudeCode.ready) return all.claudeCode;
  if (all.openCode.ready) return all.openCode;
  return null;
}

// "Why isn't `active` set?" — drives the copy on the gating buttons.
//   checking   detection still in flight
//   missing    no engine installed; offer install hints
//   must-pick  both installed; user has not chosen which one to spawn
//   ready      a spawn is possible right now
export type EngineGate = "checking" | "missing" | "must-pick" | "ready";

export interface EngineGateInput {
  claudeCode: ClaudeCodeEngineStatus | "checking";
  openCode: OpenCodeEngineStatus | "checking";
  preferred: AiEngineId | null;
}

export function gateForEngine(snap: EngineGateInput): EngineGate {
  if (snap.claudeCode === "checking" || snap.openCode === "checking") return "checking";
  const claudeReady = snap.claudeCode.ready;
  const openReady = snap.openCode.ready;
  if (!claudeReady && !openReady) return "missing";
  if (claudeReady && openReady && snap.preferred === null) return "must-pick";
  return "ready";
}

export class AiEngineUnavailable extends Error {
  readonly statuses: AllEngineStatuses;
  constructor(statuses: AllEngineStatuses) {
    super("No AI engine is installed.");
    this.name = "AiEngineUnavailable";
    this.statuses = statuses;
  }
}

export class AiEngineMustPick extends Error {
  readonly statuses: AllEngineStatuses;
  constructor(statuses: AllEngineStatuses) {
    super("Pick an engine in Settings to continue.");
    this.name = "AiEngineMustPick";
    this.statuses = statuses;
  }
}

// Throws AiEngineUnavailable when no engine is ready, or AiEngineMustPick
// when both are ready and the user hasn't picked one. Forces a fresh
// detection first so a freshly-installed binary unlocks immediately without
// a 24h cache wait.
export async function requireSpawnEngine(): Promise<AiEngineStatus> {
  const cached = await readAllEngineStatuses(false);
  const preferred = await getPreferredEngine();
  const fromCache = resolveSpawnEngine(cached, preferred);
  if (fromCache !== null) return fromCache;
  const fresh = await readAllEngineStatuses(true);
  const fromFresh = resolveSpawnEngine(fresh, preferred);
  if (fromFresh !== null) return fromFresh;
  if (fresh.claudeCode.ready && fresh.openCode.ready) {
    throw new AiEngineMustPick(fresh);
  }
  throw new AiEngineUnavailable(fresh);
}

export function aiEngineInstallHints(id: AiEngineId, os: HostOs): InstallHint[] {
  if (id === "claudeCode") return claudeCodeInstallHints(os);
  return openCodeInstallHints(os);
}

function claudeCodeInstallHints(os: HostOs): InstallHint[] {
  if (os === "macos") {
    return [
      { label: "Homebrew", command: "brew install --cask claude-code", preferred: true },
      { label: "Native installer", command: "curl -fsSL https://claude.ai/install.sh | bash" },
    ];
  }
  if (os === "linux") {
    return [
      {
        label: "Native installer",
        command: "curl -fsSL https://claude.ai/install.sh | bash",
        preferred: true,
      },
    ];
  }
  if (os === "windows") {
    return [
      { label: "PowerShell", command: "irm https://claude.ai/install.ps1 | iex", preferred: true },
      { label: "winget", command: "winget install Anthropic.ClaudeCode" },
    ];
  }
  return [
    {
      label: "Native installer",
      command: "curl -fsSL https://claude.ai/install.sh | bash",
      preferred: true,
    },
  ];
}

function openCodeInstallHints(os: HostOs): InstallHint[] {
  if (os === "macos") {
    return [
      { label: "Homebrew", command: "brew install sst/tap/opencode", preferred: true },
      { label: "Native installer", command: "curl -fsSL https://opencode.ai/install | bash" },
      { label: "npm", command: "npm i -g opencode-ai" },
    ];
  }
  if (os === "linux") {
    return [
      {
        label: "Native installer",
        command: "curl -fsSL https://opencode.ai/install | bash",
        preferred: true,
      },
      { label: "npm", command: "npm i -g opencode-ai" },
    ];
  }
  if (os === "windows") {
    return [
      { label: "Scoop", command: "scoop install opencode", preferred: true },
      { label: "npm", command: "npm i -g opencode-ai" },
    ];
  }
  return [
    {
      label: "Native installer",
      command: "curl -fsSL https://opencode.ai/install | bash",
      preferred: true,
    },
    { label: "npm", command: "npm i -g opencode-ai" },
  ];
}
