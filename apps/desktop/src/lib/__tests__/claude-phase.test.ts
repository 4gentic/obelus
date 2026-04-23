import { type ParsedStreamEvent, parseStreamLine } from "@obelus/claude-sidecar";
import { describe, expect, it } from "vitest";
import { extractPhaseMarker, isSemanticPhase, phaseFromEvent } from "../claude-phase";

function assistantText(text: string): ParsedStreamEvent {
  const parsed = parseStreamLine(
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text }] },
    }),
  );
  if (!parsed) throw new Error("assistantText: parse returned null");
  return parsed;
}

function toolUse(name: string, input: Record<string, unknown>): ParsedStreamEvent {
  const parsed = parseStreamLine(
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name, input }] },
    }),
  );
  if (!parsed) throw new Error("toolUse: parse returned null");
  return parsed;
}

describe("extractPhaseMarker", () => {
  it("returns the token after [obelus:phase]", () => {
    expect(extractPhaseMarker(assistantText("[obelus:phase] locating-spans"))).toBe(
      "locating-spans",
    );
  });

  it("tolerates surrounding whitespace and preceding narration", () => {
    expect(
      extractPhaseMarker(
        assistantText("Reading the paper first.\n\n[obelus:phase]  stress-test\n"),
      ),
    ).toBe("stress-test");
  });

  it("returns null when no marker is present", () => {
    expect(
      extractPhaseMarker(assistantText("Just narrating without any phase marker.")),
    ).toBeNull();
  });

  it("returns null for tool-use events (no assistant text)", () => {
    expect(extractPhaseMarker(toolUse("Read", { file_path: "main.tex" }))).toBeNull();
  });

  it("isSemanticPhase is true only for obelus:-prefixed phases", () => {
    expect(isSemanticPhase("obelus:stress-test")).toBe(true);
    expect(isSemanticPhase("Reading main.tex")).toBe(false);
  });
});

describe("phaseFromEvent", () => {
  it("describes a Read tool call", () => {
    expect(phaseFromEvent(toolUse("Read", { file_path: "/abs/path/main.tex" }))).toBe(
      "Reading main.tex",
    );
  });

  it("returns null for pure text events", () => {
    // phaseFromEvent only looks at tool_use blocks; marker detection lives in
    // extractPhaseMarker and is the listener's preferred source.
    expect(phaseFromEvent(assistantText("[obelus:phase] locating-spans"))).toBeNull();
  });
});
