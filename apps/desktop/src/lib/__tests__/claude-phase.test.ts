import { type ParsedStreamEvent, parseStreamLine } from "@obelus/claude-sidecar";
import { describe, expect, it } from "vitest";
import {
  extractNoteMarker,
  extractPhaseMarker,
  humanizePhase,
  isSemanticPhase,
  phaseFromEvent,
  summarizeToolResult,
} from "../claude-phase";

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

  it("describes a Read with camelCase filePath (OpenCode convention)", () => {
    // OpenCode emits tool inputs as camelCase; describePhase falls back to the
    // camel form when the snake form is missing so the narration stays useful.
    expect(phaseFromEvent(toolUse("Read", { filePath: "/abs/path/main.tex" }))).toBe(
      "Reading main.tex",
    );
  });

  it("describes a NotebookEdit with camelCase notebookPath", () => {
    expect(phaseFromEvent(toolUse("NotebookEdit", { notebookPath: "/abs/sketch.ipynb" }))).toBe(
      "Editing sketch.ipynb",
    );
  });
});

describe("humanizePhase", () => {
  it("maps every known skill phase token to its noun phrase", () => {
    expect(humanizePhase("preflight")).toBe("Preparing");
    expect(humanizePhase("gather-context")).toBe("Gathering context");
    expect(humanizePhase("locating-spans")).toBe("Locating passages");
    expect(humanizePhase("stress-test")).toBe("Stress-testing edits");
    expect(humanizePhase("impact-sweep")).toBe("Impact sweep");
    expect(humanizePhase("coherence-sweep")).toBe("Coherence sweep");
    expect(humanizePhase("quality-sweep")).toBe("Quality sweep");
    expect(humanizePhase("writing-plan")).toBe("Writing the plan");
  });

  it("title-cases an unknown token on its hyphens", () => {
    expect(humanizePhase("final-polish-pass")).toBe("Final Polish Pass");
    expect(humanizePhase("triage")).toBe("Triage");
  });
});

describe("extractNoteMarker", () => {
  it("returns the free text after [obelus:note]", () => {
    expect(extractNoteMarker(assistantText("[obelus:note] Drafted 6 edits"))).toBe(
      "Drafted 6 edits",
    );
  });

  it("captures the whole line and trims surrounding whitespace", () => {
    const event = assistantText("narration\n[obelus:note]   Two passages still ambiguous  \n");
    expect(extractNoteMarker(event)).toBe("Two passages still ambiguous");
  });

  it("returns null when no note marker is present", () => {
    expect(extractNoteMarker(assistantText("Just narrating."))).toBeNull();
  });

  it("does not match a phase marker", () => {
    expect(extractNoteMarker(assistantText("[obelus:phase] stress-test"))).toBeNull();
  });
});

describe("summarizeToolResult", () => {
  it("counts lines for a Read result", () => {
    expect(summarizeToolResult("Read", "line one\nline two\nline three", false)).toBe("3 lines");
    expect(summarizeToolResult("Read", "only one line", false)).toBe("1 line");
  });

  it("counts non-empty matches for a Grep result", () => {
    expect(summarizeToolResult("Grep", "src/a.ts:3\n\nsrc/b.ts:9\n", false)).toBe("2 matches");
    expect(summarizeToolResult("Grep", "src/only.ts:1", false)).toBe("1 match");
  });

  it("reports an error regardless of tool or content", () => {
    expect(summarizeToolResult("Read", "partial output", true)).toBe("error");
    expect(summarizeToolResult("Bash", "", true)).toBe("error");
  });

  it("falls back to the first non-empty line, truncated, for other tools", () => {
    expect(summarizeToolResult("Bash", "\n\ncompiled in 1.2s\nmore", false)).toBe(
      "compiled in 1.2s",
    );
  });

  it("returns 'done' for empty non-Read/Grep content", () => {
    expect(summarizeToolResult("Bash", "", false)).toBe("done");
    expect(summarizeToolResult("Write", "   \n  ", false)).toBe("done");
  });

  it("reports zero lines for empty Read content", () => {
    expect(summarizeToolResult("Read", "", false)).toBe("0 lines");
  });
});
