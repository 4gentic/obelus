import { describe, expect, it } from "vitest";
import { stallThresholdMs } from "../jobs-store";

describe("stallThresholdMs", () => {
  it("gives Claude Code the tight 3-minute window — its partial-message stream makes silence anomalous", () => {
    expect(stallThresholdMs("claudeCode")).toBe(180_000);
  });

  it("gives OpenCode a wider 6-minute window — it only streams at step boundaries, so reasoning gaps are normal", () => {
    expect(stallThresholdMs("openCode")).toBe(360_000);
  });

  it("falls back to the Claude window for an unknown engine (the reattach path can't recover it)", () => {
    expect(stallThresholdMs(undefined)).toBe(180_000);
  });
});
