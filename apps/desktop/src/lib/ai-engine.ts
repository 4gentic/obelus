import { type ClaudeStatus, detectClaude, type HostOs } from "../ipc/commands";
import { getAppState, setAppState } from "../store/app-state";

// One AI engine variant today. The discriminated union shape lets a second
// engine arrive without touching call sites: every gate consults
// `isAiEngineReady(status)` and renders `aiEngineInstallHints(engine, host)`.
export type AiEngineId = "claudeCode";

export interface ClaudeCodeEngineStatus {
  engine: "claudeCode";
  ready: boolean;
  hostOs: HostOs;
  raw: ClaudeStatus;
}

export type AiEngineStatus = ClaudeCodeEngineStatus;

export interface InstallHint {
  label: string;
  command: string;
  preferred?: boolean;
}

export const ACTIVE_AI_ENGINE: AiEngineId = "claudeCode";

const CACHE_TTL_MS = 1000 * 60 * 60 * 24;

export function aiEngineLabel(id: AiEngineId): string {
  if (id === "claudeCode") return "Claude Code";
  return id;
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

function toEngineStatus(raw: ClaudeStatus): AiEngineStatus {
  return {
    engine: "claudeCode",
    ready: isReadyClaudeState(raw.status),
    hostOs: raw.hostOs,
    raw,
  };
}

export async function readAiEngineStatus(force = false): Promise<AiEngineStatus> {
  if (!force) {
    const cached = await getAppState("claudeDetectCache");
    // Caches written before HostOs landed will have an undefined `hostOs`;
    // refuse them and re-detect rather than guess a host platform.
    if (cached?.status.hostOs && Date.now() - new Date(cached.checkedAt).getTime() < CACHE_TTL_MS) {
      return toEngineStatus(cached.status);
    }
  }
  const raw = await detectClaude();
  await setAppState("claudeDetectCache", {
    status: raw,
    checkedAt: new Date().toISOString(),
  });
  return toEngineStatus(raw);
}

export class AiEngineUnavailable extends Error {
  readonly status: AiEngineStatus;
  constructor(status: AiEngineStatus) {
    super(`${aiEngineLabel(status.engine)} is not installed.`);
    this.name = "AiEngineUnavailable";
    this.status = status;
  }
}

// Throws AiEngineUnavailable when the engine is not ready. Forces a fresh
// detection first so a freshly-installed binary unlocks immediately without a
// 24h cache wait.
export async function requireAiEngineReady(): Promise<AiEngineStatus> {
  const cached = await readAiEngineStatus(false);
  if (cached.ready) return cached;
  const fresh = await readAiEngineStatus(true);
  if (!fresh.ready) throw new AiEngineUnavailable(fresh);
  return fresh;
}

export function aiEngineInstallHints(id: AiEngineId, os: HostOs): InstallHint[] {
  if (id !== "claudeCode") return [];
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
