import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaudeStatus, HostOs, OpenCodeStatus } from "../../ipc/commands";
import { detectClaude, detectOpenCode } from "../../ipc/commands";
import { getAppState, setAppState } from "../../store/app-state";
import {
  AiEngineMustPick,
  AiEngineUnavailable,
  type AllEngineStatuses,
  aiEngineInstallHints,
  aiEngineLabel,
  type ClaudeCodeEngineStatus,
  gateForEngine,
  isAiEngineReady,
  type OpenCodeEngineStatus,
  requireSpawnEngine,
  resolveSpawnEngine,
} from "../ai-engine";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-store", () => ({
  Store: { load: vi.fn(async () => ({ get: vi.fn(), set: vi.fn(), save: vi.fn() })) },
}));

// Mock the immediate dependencies of requireSpawnEngine so the cached/fresh
// fall-through and the throw branches can be driven from individual tests.
vi.mock("../../ipc/commands", async () => {
  const actual = await vi.importActual<typeof import("../../ipc/commands")>("../../ipc/commands");
  return {
    ...actual,
    detectClaude: vi.fn(),
    detectOpenCode: vi.fn(),
  };
});
vi.mock("../../store/app-state", () => ({
  getAppState: vi.fn(),
  setAppState: vi.fn(),
}));

function makeClaudeRaw(state: ClaudeStatus["status"], hostOs: HostOs = "linux"): ClaudeStatus {
  return {
    path: state === "notFound" ? null : "/usr/local/bin/claude",
    version: state === "notFound" ? null : "2.0.0",
    status: state,
    floor: "2.0.0",
    ceilExclusive: "3.0.0",
    hostOs,
  };
}

function makeOpenCodeRaw(
  state: OpenCodeStatus["status"],
  hostOs: HostOs = "linux",
): OpenCodeStatus {
  return {
    path: state === "notFound" ? null : "/usr/local/bin/opencode",
    version: state === "notFound" ? null : "0.5.0",
    status: state,
    hostOs,
  };
}

function makeClaudeStatus(ready: boolean, raw: ClaudeStatus): ClaudeCodeEngineStatus {
  return { engine: "claudeCode", ready, hostOs: raw.hostOs, raw };
}

function makeOpenCodeStatus(ready: boolean, raw: OpenCodeStatus): OpenCodeEngineStatus {
  return { engine: "openCode", ready, hostOs: raw.hostOs, raw };
}

function makeAllStatuses(
  claude: ClaudeCodeEngineStatus,
  open: OpenCodeEngineStatus,
): AllEngineStatuses {
  return { claudeCode: claude, openCode: open };
}

describe("ai-engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("aiEngineLabel", () => {
    it("renders the human label for each engine", () => {
      expect(aiEngineLabel("claudeCode")).toBe("Claude Code");
      expect(aiEngineLabel("openCode")).toBe("OpenCode");
    });
  });

  describe("isAiEngineReady", () => {
    it("returns false for the checking sentinel", () => {
      expect(isAiEngineReady("checking")).toBe(false);
    });

    it("returns false for null", () => {
      expect(isAiEngineReady(null)).toBe(false);
    });

    it("returns the status's ready flag for a real status", () => {
      expect(isAiEngineReady(makeClaudeStatus(true, makeClaudeRaw("found")))).toBe(true);
      expect(isAiEngineReady(makeClaudeStatus(false, makeClaudeRaw("notFound")))).toBe(false);
      expect(isAiEngineReady(makeOpenCodeStatus(true, makeOpenCodeRaw("found")))).toBe(true);
    });
  });

  describe("resolveSpawnEngine", () => {
    it("prefers the explicitly chosen engine when ready", () => {
      const all = makeAllStatuses(
        makeClaudeStatus(true, makeClaudeRaw("found")),
        makeOpenCodeStatus(true, makeOpenCodeRaw("found")),
      );
      expect(resolveSpawnEngine(all, "openCode")?.engine).toBe("openCode");
      expect(resolveSpawnEngine(all, "claudeCode")?.engine).toBe("claudeCode");
    });

    it("falls back to any ready engine when the preferred one is not ready", () => {
      const all = makeAllStatuses(
        makeClaudeStatus(false, makeClaudeRaw("notFound")),
        makeOpenCodeStatus(true, makeOpenCodeRaw("found")),
      );
      expect(resolveSpawnEngine(all, "claudeCode")?.engine).toBe("openCode");
    });

    it("returns null when no engine is ready", () => {
      const all = makeAllStatuses(
        makeClaudeStatus(false, makeClaudeRaw("notFound")),
        makeOpenCodeStatus(false, makeOpenCodeRaw("notFound")),
      );
      expect(resolveSpawnEngine(all, null)).toBeNull();
    });

    it("returns null when both are ready and no preference exists", () => {
      // The user must explicitly pick. We refuse to default to either when
      // both are installed — the gating layer surfaces a "Pick an engine"
      // message instead of silently choosing.
      const all = makeAllStatuses(
        makeClaudeStatus(true, makeClaudeRaw("found")),
        makeOpenCodeStatus(true, makeOpenCodeRaw("found")),
      );
      expect(resolveSpawnEngine(all, null)).toBeNull();
    });
  });

  describe("gateForEngine", () => {
    it("returns 'checking' while either detection is in flight", () => {
      expect(
        gateForEngine({
          claudeCode: "checking",
          openCode: makeOpenCodeStatus(true, makeOpenCodeRaw("found")),
          preferred: null,
        }),
      ).toBe("checking");
      expect(
        gateForEngine({
          claudeCode: makeClaudeStatus(true, makeClaudeRaw("found")),
          openCode: "checking",
          preferred: null,
        }),
      ).toBe("checking");
    });

    it("returns 'missing' when neither engine is ready", () => {
      expect(
        gateForEngine({
          claudeCode: makeClaudeStatus(false, makeClaudeRaw("notFound")),
          openCode: makeOpenCodeStatus(false, makeOpenCodeRaw("notFound")),
          preferred: null,
        }),
      ).toBe("missing");
    });

    it("returns 'must-pick' when both ready and no preference recorded", () => {
      expect(
        gateForEngine({
          claudeCode: makeClaudeStatus(true, makeClaudeRaw("found")),
          openCode: makeOpenCodeStatus(true, makeOpenCodeRaw("found")),
          preferred: null,
        }),
      ).toBe("must-pick");
    });

    it("returns 'ready' when both ready and a preference is set", () => {
      expect(
        gateForEngine({
          claudeCode: makeClaudeStatus(true, makeClaudeRaw("found")),
          openCode: makeOpenCodeStatus(true, makeOpenCodeRaw("found")),
          preferred: "openCode",
        }),
      ).toBe("ready");
    });

    it("returns 'ready' when exactly one engine is ready", () => {
      expect(
        gateForEngine({
          claudeCode: makeClaudeStatus(true, makeClaudeRaw("found")),
          openCode: makeOpenCodeStatus(false, makeOpenCodeRaw("notFound")),
          preferred: null,
        }),
      ).toBe("ready");
    });
  });

  describe("AiEngineUnavailable", () => {
    it("carries both engine statuses and an engine-neutral message", () => {
      const all = makeAllStatuses(
        makeClaudeStatus(false, makeClaudeRaw("notFound")),
        makeOpenCodeStatus(false, makeOpenCodeRaw("notFound")),
      );
      const err = new AiEngineUnavailable(all);
      expect(err.statuses).toBe(all);
      expect(err.message).toContain("AI engine");
      expect(err.name).toBe("AiEngineUnavailable");
    });
  });

  describe("AiEngineMustPick", () => {
    it("carries both ready statuses and a pick-an-engine message", () => {
      const all = makeAllStatuses(
        makeClaudeStatus(true, makeClaudeRaw("found")),
        makeOpenCodeStatus(true, makeOpenCodeRaw("found")),
      );
      const err = new AiEngineMustPick(all);
      expect(err.statuses).toBe(all);
      expect(err.message).toContain("Pick an engine");
      expect(err.name).toBe("AiEngineMustPick");
    });
  });

  describe("aiEngineInstallHints — Claude Code", () => {
    it("offers Homebrew and the native installer on macOS, Homebrew preferred", () => {
      const hints = aiEngineInstallHints("claudeCode", "macos");
      expect(hints.map((h) => h.label)).toEqual(["Homebrew", "Native installer"]);
      expect(hints[0]?.command).toBe("brew install --cask claude-code");
      expect(hints[0]?.preferred).toBe(true);
    });

    it("offers only the native installer on Linux", () => {
      const hints = aiEngineInstallHints("claudeCode", "linux");
      expect(hints).toHaveLength(1);
      expect(hints[0]?.command).toBe("curl -fsSL https://claude.ai/install.sh | bash");
      expect(hints[0]?.preferred).toBe(true);
    });

    it("offers PowerShell and winget on Windows, PowerShell preferred", () => {
      const hints = aiEngineInstallHints("claudeCode", "windows");
      expect(hints.map((h) => h.label)).toEqual(["PowerShell", "winget"]);
      expect(hints[0]?.command).toBe("irm https://claude.ai/install.ps1 | iex");
      expect(hints[0]?.preferred).toBe(true);
    });

    it("falls back to the native installer for unknown hosts", () => {
      const hints = aiEngineInstallHints("claudeCode", "other");
      expect(hints).toHaveLength(1);
      expect(hints[0]?.command).toBe("curl -fsSL https://claude.ai/install.sh | bash");
    });

    it("never references the deprecated npm package", () => {
      for (const os of ["macos", "linux", "windows", "other"] as const) {
        for (const hint of aiEngineInstallHints("claudeCode", os)) {
          expect(hint.command).not.toContain("@anthropic-ai/claude-code");
          expect(hint.command).not.toContain("anthropic/tap/claude");
        }
      }
    });
  });

  describe("aiEngineInstallHints — OpenCode", () => {
    it("offers Homebrew (preferred), native installer, and npm on macOS", () => {
      const hints = aiEngineInstallHints("openCode", "macos");
      expect(hints.map((h) => h.label)).toEqual(["Homebrew", "Native installer", "npm"]);
      expect(hints[0]?.command).toBe("brew install sst/tap/opencode");
      expect(hints[0]?.preferred).toBe(true);
    });

    it("offers the native installer (preferred) and npm on Linux", () => {
      const hints = aiEngineInstallHints("openCode", "linux");
      expect(hints.map((h) => h.label)).toEqual(["Native installer", "npm"]);
      expect(hints[0]?.command).toBe("curl -fsSL https://opencode.ai/install | bash");
      expect(hints[0]?.preferred).toBe(true);
    });

    it("offers Scoop (preferred) and npm on Windows", () => {
      const hints = aiEngineInstallHints("openCode", "windows");
      expect(hints.map((h) => h.label)).toEqual(["Scoop", "npm"]);
      expect(hints[0]?.command).toBe("scoop install opencode");
      expect(hints[0]?.preferred).toBe(true);
    });
  });

  describe("requireSpawnEngine", () => {
    beforeEach(() => {
      vi.mocked(detectClaude).mockReset();
      vi.mocked(detectOpenCode).mockReset();
      vi.mocked(getAppState).mockReset();
      vi.mocked(setAppState).mockReset();
      // Default: empty cache, no preference, writes succeed.
      vi.mocked(getAppState).mockImplementation(async () => undefined as never);
      vi.mocked(setAppState).mockResolvedValue(undefined);
    });

    it("returns the only ready engine when one is found and no preference is set", async () => {
      vi.mocked(detectClaude).mockResolvedValue(makeClaudeRaw("found"));
      vi.mocked(detectOpenCode).mockResolvedValue(makeOpenCodeRaw("notFound"));

      const result = await requireSpawnEngine();

      expect(result.engine).toBe("claudeCode");
      expect(result.ready).toBe(true);
    });

    it("throws AiEngineUnavailable when no engine is ready", async () => {
      vi.mocked(detectClaude).mockResolvedValue(makeClaudeRaw("notFound"));
      vi.mocked(detectOpenCode).mockResolvedValue(makeOpenCodeRaw("notFound"));

      await expect(requireSpawnEngine()).rejects.toBeInstanceOf(AiEngineUnavailable);
    });

    it("throws AiEngineMustPick when both ready and no preference is set", async () => {
      vi.mocked(detectClaude).mockResolvedValue(makeClaudeRaw("found"));
      vi.mocked(detectOpenCode).mockResolvedValue(makeOpenCodeRaw("found"));

      await expect(requireSpawnEngine()).rejects.toBeInstanceOf(AiEngineMustPick);
    });

    it("falls through from a stale cache to a fresh detect when the cache reports no ready engine", async () => {
      // Cache reports both engines as notFound. Live detect finds Claude.
      // The fall-through is the only way the call can resolve to a ready
      // status — proving requireSpawnEngine doesn't trust a stale cache.
      const checkedAt = new Date().toISOString();
      vi.mocked(getAppState).mockImplementation(async (key: string) => {
        if (key === "claudeDetectCache") {
          return { status: makeClaudeRaw("notFound"), checkedAt } as never;
        }
        if (key === "openCodeDetectCache") {
          return { status: makeOpenCodeRaw("notFound"), checkedAt } as never;
        }
        return undefined as never;
      });
      vi.mocked(detectClaude).mockResolvedValue(makeClaudeRaw("found"));
      vi.mocked(detectOpenCode).mockResolvedValue(makeOpenCodeRaw("notFound"));

      const result = await requireSpawnEngine();

      expect(result.engine).toBe("claudeCode");
      expect(detectClaude).toHaveBeenCalled();
      expect(detectOpenCode).toHaveBeenCalled();
    });
  });
});
