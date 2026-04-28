import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaudeStatus, HostOs } from "../../ipc/commands";
import {
  type AiEngineStatus,
  AiEngineUnavailable,
  aiEngineInstallHints,
  aiEngineLabel,
  isAiEngineReady,
} from "../ai-engine";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-store", () => ({
  Store: { load: vi.fn(async () => ({ get: vi.fn(), set: vi.fn(), save: vi.fn() })) },
}));

function makeRaw(state: ClaudeStatus["status"], hostOs: HostOs = "linux"): ClaudeStatus {
  return {
    path: state === "notFound" ? null : "/usr/local/bin/claude",
    version: state === "notFound" ? null : "2.0.0",
    status: state,
    floor: "2.0.0",
    ceilExclusive: "3.0.0",
    hostOs,
  };
}

function makeStatus(
  ready: boolean,
  raw: ClaudeStatus,
  hostOs: HostOs = raw.hostOs,
): AiEngineStatus {
  return { engine: "claudeCode", ready, hostOs, raw };
}

describe("ai-engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("aiEngineLabel", () => {
    it("renders the human label for claudeCode", () => {
      expect(aiEngineLabel("claudeCode")).toBe("Claude Code");
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
      expect(isAiEngineReady(makeStatus(true, makeRaw("found")))).toBe(true);
      expect(isAiEngineReady(makeStatus(false, makeRaw("notFound")))).toBe(false);
    });
  });

  describe("AiEngineUnavailable", () => {
    it("carries the offending status and a label-derived message", () => {
      const status = makeStatus(false, makeRaw("notFound"));
      const err = new AiEngineUnavailable(status);
      expect(err.status).toBe(status);
      expect(err.message).toContain("Claude Code");
      expect(err.name).toBe("AiEngineUnavailable");
    });
  });

  describe("aiEngineInstallHints", () => {
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
});
