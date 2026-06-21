import { type ParsedStreamEvent, parseStreamLine } from "@obelus/claude-sidecar";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createReviewProgressStore,
  type ReviewProgressStore,
  type TranscriptEntry,
} from "../review-progress-store";

function mustParse(value: unknown): ParsedStreamEvent {
  const parsed = parseStreamLine(JSON.stringify(value));
  if (!parsed) throw new Error("parseStreamLine returned null");
  return parsed;
}

function assistantText(text: string): ParsedStreamEvent {
  return mustParse({ type: "assistant", message: { content: [{ type: "text", text }] } });
}

function thinking(text: string): ParsedStreamEvent {
  return mustParse({
    type: "assistant",
    message: { content: [{ type: "thinking", thinking: text }] },
  });
}

type SyntheticUse = { name: string; input: unknown; id: string };

function toolUses(uses: ReadonlyArray<SyntheticUse>): ParsedStreamEvent {
  return mustParse({
    type: "assistant",
    message: {
      content: uses.map((u) => ({ type: "tool_use", name: u.name, input: u.input, id: u.id })),
    },
  });
}

function toolResults(
  results: ReadonlyArray<{ id: string; content: string; isError?: boolean }>,
): ParsedStreamEvent {
  return mustParse({
    type: "user",
    message: {
      content: results.map((r) => ({
        type: "tool_result",
        tool_use_id: r.id,
        content: r.content,
        ...(r.isError ? { is_error: true } : {}),
      })),
    },
  });
}

function kinds(entries: ReadonlyArray<TranscriptEntry>): string[] {
  return entries.map((e) => e.kind);
}

describe("review-progress-store ingest", () => {
  let store: ReviewProgressStore;

  beforeEach(() => {
    store = createReviewProgressStore();
    store.getState().start();
  });

  it("turns a phase marker into a phase entry + header, never a raw assistant line", () => {
    store.getState().ingest(assistantText("[obelus:phase] gather-context"));
    const { entries, phase } = store.getState();
    expect(kinds(entries)).toEqual(["phase"]);
    expect(entries[0]).toEqual({ kind: "phase", label: "Gathering context" });
    expect(phase).toBe("Gathering context");
    expect(entries.some((e) => e.kind === "assistant" && e.text.includes("obelus:phase"))).toBe(
      false,
    );
  });

  it("keeps surrounding prose but strips the marker line", () => {
    store
      .getState()
      .ingest(assistantText("[obelus:phase] stress-test\nProbing the weakest claim now."));
    const { entries } = store.getState();
    expect(kinds(entries)).toEqual(["phase", "assistant"]);
    expect(entries[1]).toEqual({ kind: "assistant", text: "Probing the weakest claim now." });
  });

  it("emits a note entry for a [obelus:note] marker", () => {
    store.getState().ingest(assistantText("[obelus:note] Drafted 6 edits"));
    const { entries } = store.getState();
    expect(kinds(entries)).toEqual(["note"]);
    expect(entries[0]).toEqual({ kind: "note", text: "Drafted 6 edits" });
  });

  it("keeps the thinking text in a thinking entry and sets the pulse", () => {
    store.getState().ingest(thinking("Weighing two readings of the lemma."));
    const { entries, lastThinkingAt } = store.getState();
    expect(kinds(entries)).toEqual(["thinking"]);
    expect(entries[0]).toEqual({ kind: "thinking", text: "Weighing two readings of the lemma." });
    expect(lastThinkingAt).not.toBeNull();
  });

  it("coalesces a uniform batch of Reads into one breadcrumb, collapsing to done", () => {
    const uses: SyntheticUse[] = Array.from({ length: 11 }, (_, i) => ({
      name: "Read",
      input: { file_path: `/paper/sec${i}.tex` },
      id: `toolu_${i}`,
    }));
    store.getState().ingest(toolUses(uses));

    let entries = store.getState().entries;
    expect(kinds(entries)).toEqual(["tool"]);
    expect(entries[0]).toEqual({ kind: "tool", label: "Reading 11 files" });
    expect(store.getState().toolEvents).toBe(11);

    store.getState().ingest(toolResults(uses.map((u) => ({ id: u.id, content: "x\ny\nz" }))));
    entries = store.getState().entries;
    expect(entries[0]).toEqual({
      kind: "tool",
      label: "Reading 11 files",
      result: "done",
      error: false,
    });
  });

  it("summarises a single tool result by line count for Read", () => {
    const use: SyntheticUse = {
      name: "Read",
      input: { file_path: "/paper/main.tex" },
      id: "toolu_a",
    };
    store.getState().ingest(toolUses([use]));
    store.getState().ingest(toolResults([{ id: use.id, content: "a\nb\nc\nd" }]));
    expect(store.getState().entries[0]).toEqual({
      kind: "tool",
      label: "Reading main.tex",
      result: "4 lines",
      error: false,
    });
  });

  it("does not let a tool breadcrumb overwrite the header once a semantic phase has fired", () => {
    store.getState().ingest(assistantText("[obelus:phase] coherence-sweep"));
    store
      .getState()
      .ingest(toolUses([{ name: "Read", input: { file_path: "/paper/main.tex" }, id: "toolu_b" }]));
    expect(store.getState().phase).toBe("Coherence sweep");
  });

  it("clears the thinking pulse on a result and surfaces a trailing note", () => {
    store.getState().ingest(thinking("…"));
    const result = mustParse({
      type: "result",
      subtype: "success",
      result: "[obelus:note] Plan ready",
    });
    store.getState().ingest(result);
    const { entries, lastThinkingAt } = store.getState();
    expect(lastThinkingAt).toBeNull();
    expect(entries.at(-1)).toEqual({ kind: "note", text: "Plan ready" });
  });

  it("does not double a closing note already streamed before the result echoes it", () => {
    store.getState().ingest(assistantText("[obelus:note] Plan ready"));
    store
      .getState()
      .ingest(
        mustParse({ type: "result", subtype: "success", result: "[obelus:note] Plan ready" }),
      );
    const { entries } = store.getState();
    expect(kinds(entries)).toEqual(["note"]);
    expect(entries[0]).toEqual({ kind: "note", text: "Plan ready" });
  });

  it("still attaches a tool result after the window has trimmed past MAX_ENTRIES", () => {
    // Push well past the 500-entry cap so the trailing window trims from the
    // front and absolute tool indices diverge from live array slots.
    for (let i = 0; i < 520; i++) {
      store
        .getState()
        .ingest(toolUses([{ name: "Bash", input: { command: `echo ${i}` }, id: `fill_${i}` }]));
    }
    expect(store.getState().trimmed).toBe(true);

    const late: SyntheticUse = {
      name: "Read",
      input: { file_path: "/paper/late.tex" },
      id: "toolu_late",
    };
    store.getState().ingest(toolUses([late]));
    store.getState().ingest(toolResults([{ id: late.id, content: "a\nb\nc\nd\ne" }]));

    expect(store.getState().entries.at(-1)).toEqual({
      kind: "tool",
      label: "Reading late.tex",
      result: "5 lines",
      error: false,
    });
  });
});
