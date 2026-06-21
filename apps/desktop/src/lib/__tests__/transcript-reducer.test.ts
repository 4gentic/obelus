import { type ParsedStreamEvent, parseStreamLine } from "@obelus/claude-sidecar";
import { describe, expect, it } from "vitest";
import {
  emptyState,
  finalize,
  ingest,
  MAX_BLOCKS,
  type NoteBlock,
  type TextBlock,
  type ThinkingBlock,
  type ToolBlock,
  type ToolGroupBlock,
  type TranscriptState,
} from "../transcript-reducer";

function ev(line: string): ParsedStreamEvent {
  const parsed = parseStreamLine(line);
  if (!parsed) throw new Error(`parseStreamLine returned null for: ${line}`);
  return parsed;
}

function feed(state: TranscriptState, lines: ReadonlyArray<string>, atMs = 1_000): TranscriptState {
  let s = state;
  let t = atMs;
  for (const line of lines) {
    s = ingest(s, ev(line), t);
    t += 10;
  }
  return s;
}

const textDelta = (text: string): string =>
  JSON.stringify({
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
  });

const thinkingDelta = (thinking: string): string =>
  JSON.stringify({
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking } },
  });

const blockStop = (): string =>
  JSON.stringify({ type: "stream_event", event: { type: "content_block_stop", index: 0 } });

const assistantEvent = (content: ReadonlyArray<unknown>): string =>
  JSON.stringify({ type: "assistant", message: { content } });

const userToolResult = (toolUseId: string, content: string, isError = false): string =>
  JSON.stringify({
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          ...(isError ? { is_error: true } : {}),
          content,
        },
      ],
    },
  });

describe("text streaming", () => {
  it("accumulates deltas into one open text block until content_block_stop", () => {
    const s = feed(emptyState(), [textDelta("Hello "), textDelta("world")]);
    expect(s.blocks).toHaveLength(1);
    const text = s.blocks[0] as TextBlock;
    expect(text.kind).toBe("text");
    expect(text.text).toBe("Hello world");
    expect(text.closed).toBe(false);

    const closed = feed(s, [blockStop()]);
    const final = closed.blocks[0] as TextBlock;
    expect(final.closed).toBe(true);
  });

  it("does not duplicate text already streamed when the assistant event arrives", () => {
    const s = feed(emptyState(), [
      textDelta("Reviewing section 3"),
      blockStop(),
      assistantEvent([{ type: "text", text: "Reviewing section 3" }]),
    ]);
    expect(s.blocks).toHaveLength(1);
    expect((s.blocks[0] as TextBlock).text).toBe("Reviewing section 3");
  });

  it("pushes a closed text block from an assistant event when no deltas were seen", () => {
    const s = feed(emptyState(), [
      assistantEvent([{ type: "text", text: "OpenCode-style closed text" }]),
    ]);
    expect(s.blocks).toHaveLength(1);
    const t = s.blocks[0] as TextBlock;
    expect(t.kind).toBe("text");
    expect(t.text).toBe("OpenCode-style closed text");
    expect(t.closed).toBe(true);
  });
});

describe("obelus markers", () => {
  it("emits a NoteBlock for an [obelus:note] line", () => {
    const s = feed(emptyState(), [
      assistantEvent([{ type: "text", text: "[obelus:note] Drafted 6 edits" }]),
    ]);
    const note = s.blocks.find((b) => b.kind === "note") as NoteBlock | undefined;
    expect(note).toBeDefined();
    expect(note?.text).toBe("Drafted 6 edits");
  });

  it("does not leak [obelus:note] / [obelus:phase] marker lines into any TextBlock", () => {
    const s = feed(emptyState(), [
      assistantEvent([
        {
          type: "text",
          text: "[obelus:phase] stress-test\nChecking the claim in section 3.\n[obelus:note] Drafted 6 edits",
        },
      ]),
    ]);
    for (const b of s.blocks) {
      if (b.kind === "text") {
        expect(b.text).not.toContain("[obelus:");
      }
    }
    // The surrounding prose survives; only the marker lines are stripped.
    const text = s.blocks.find((b) => b.kind === "text") as TextBlock | undefined;
    expect(text?.text).toBe("Checking the claim in section 3.");
    const note = s.blocks.find((b) => b.kind === "note") as NoteBlock | undefined;
    expect(note?.text).toBe("Drafted 6 edits");
  });

  it("strips a marker line out of streamed deltas once the block closes", () => {
    const s = feed(emptyState(), [
      textDelta("[obelus:phase] gather-context\n"),
      textDelta("Reading the introduction."),
      blockStop(),
    ]);
    const text = s.blocks.find((b) => b.kind === "text") as TextBlock | undefined;
    expect(text?.closed).toBe(true);
    expect(text?.text).toBe("Reading the introduction.");
    expect(text?.text).not.toContain("[obelus:");
  });
});

describe("thinking", () => {
  it("streams thinking deltas into a separate block from text", () => {
    const s = feed(emptyState(), [
      thinkingDelta("Weighing two readings of the claim "),
      thinkingDelta("before drafting feedback."),
    ]);
    expect(s.blocks).toHaveLength(1);
    const t = s.blocks[0] as ThinkingBlock;
    expect(t.kind).toBe("thinking");
    expect(t.text).toMatch(/^Weighing two readings/);
    expect(t.preview.length).toBeLessThanOrEqual(140);
    expect(t.closed).toBe(false);
  });

  it("pushes a closed thinking block when the assistant event has no preceding deltas", () => {
    const s = feed(emptyState(), [
      assistantEvent([{ type: "thinking", thinking: "First, I'll re-read section 3." }]),
    ]);
    expect(s.blocks).toHaveLength(1);
    const t = s.blocks[0] as ThinkingBlock;
    expect(t.kind).toBe("thinking");
    expect(t.closed).toBe(true);
  });
});

describe("tool grouping", () => {
  it("folds three consecutive Reads into a tool-group", () => {
    const s = feed(emptyState(), [
      assistantEvent([{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "a.tex" } }]),
      assistantEvent([{ type: "tool_use", id: "t2", name: "Read", input: { file_path: "b.tex" } }]),
      assistantEvent([{ type: "tool_use", id: "t3", name: "Read", input: { file_path: "c.tex" } }]),
    ]);
    expect(s.blocks).toHaveLength(1);
    const grp = s.blocks[0] as ToolGroupBlock;
    expect(grp.kind).toBe("tool-group");
    expect(grp.name).toBe("Read");
    expect(grp.members).toHaveLength(3);
  });

  it("does not group Task — distinct subagent runs stay distinct", () => {
    const s = feed(emptyState(), [
      assistantEvent([
        { type: "tool_use", id: "t1", name: "Task", input: { description: "first" } },
      ]),
      assistantEvent([
        { type: "tool_use", id: "t2", name: "Task", input: { description: "second" } },
      ]),
    ]);
    expect(s.blocks).toHaveLength(2);
    expect((s.blocks[0] as ToolBlock).kind).toBe("tool");
    expect((s.blocks[1] as ToolBlock).kind).toBe("tool");
  });

  it("does not fold Read followed by Grep", () => {
    const s = feed(emptyState(), [
      assistantEvent([{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "a.tex" } }]),
      assistantEvent([
        { type: "tool_use", id: "t2", name: "Grep", input: { pattern: "\\\\cite" } },
      ]),
    ]);
    expect(s.blocks).toHaveLength(2);
    expect(s.blocks[0]?.kind).toBe("tool");
    expect(s.blocks[1]?.kind).toBe("tool");
  });
});

describe("tool results", () => {
  it("closes a pending tool when its tool_result arrives", () => {
    const s = feed(emptyState(), [
      assistantEvent([{ type: "tool_use", id: "t1", name: "Grep", input: { pattern: "x" } }]),
      userToolResult("t1", "Found 7 matches\n…"),
    ]);
    const tool = s.blocks[0] as ToolBlock;
    expect(tool.closed).toBe(true);
    expect(tool.resultStatus).toBe("ok");
    expect(tool.resultPreview).toBe("Found 7 matches");
  });

  it("marks errored results as error", () => {
    const s = feed(emptyState(), [
      assistantEvent([{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }]),
      userToolResult("t1", "permission denied", true),
    ]);
    const tool = s.blocks[0] as ToolBlock;
    expect(tool.resultStatus).toBe("error");
  });
});

describe("OpenCode inline tool results", () => {
  it("closes an OpenCode-normalised tool immediately with the inline output", () => {
    // Mirrors the fixture in the sidecar's stream tests.
    const line = JSON.stringify({
      type: "tool_use",
      sessionID: "ses_x",
      part: {
        type: "tool",
        tool: "read",
        callID: "toolu_oc",
        state: {
          status: "completed",
          input: { filePath: "/tmp/readme.txt" },
          output: "  1  hello\n  2  world",
        },
      },
    });
    const s = feed(emptyState(), [line]);
    expect(s.blocks).toHaveLength(1);
    const tool = s.blocks[0] as ToolBlock;
    expect(tool.kind).toBe("tool");
    expect(tool.name).toBe("Read");
    expect(tool.closed).toBe(true);
    expect(tool.resultStatus).toBe("ok");
    expect(tool.resultPreview).toBe("  1  hello");
  });
});

describe("finalize", () => {
  it("appends a Done status block on successful exit", () => {
    let s = feed(emptyState(), [textDelta("hello"), blockStop()]);
    s = finalize(s, "done", 5_000);
    const last = s.blocks[s.blocks.length - 1];
    expect(last?.kind).toBe("status");
    if (last?.kind === "status") expect(last.label).toMatch(/^Done /);
  });

  it("marks pending tools as 'No result received' on cancel", () => {
    let s = feed(emptyState(), [
      assistantEvent([{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "a.tex" } }]),
    ]);
    s = finalize(s, "cancelled", 5_000);
    const tool = s.blocks[0] as ToolBlock;
    expect(tool.closed).toBe(true);
    expect(tool.resultStatus).toBe("error");
    expect(tool.resultPreview).toBe("No result received.");
    const last = s.blocks[s.blocks.length - 1];
    expect(last?.kind).toBe("status");
    if (last?.kind === "status") expect(last.label).toMatch(/^Cancelled /);
  });
});

describe("block cap", () => {
  it("drops the head and prepends an overflow marker once MAX_BLOCKS is exceeded", () => {
    let s = emptyState();
    let t = 1_000;
    for (let i = 0; i < MAX_BLOCKS + 5; i++) {
      s = ingest(
        s,
        ev(assistantEvent([{ type: "tool_use", id: `t${i}`, name: "Task", input: { i } }])),
        t,
      );
      t += 10;
    }
    expect(s.blocks.length).toBeLessThanOrEqual(MAX_BLOCKS);
    expect(s.blocks[0]?.kind).toBe("status");
    if (s.blocks[0]?.kind === "status") {
      expect(s.blocks[0].variant).toBe("overflow");
      expect(s.blocks[0].label).toMatch(/earlier event/);
    }
    expect(s.droppedForOverflow).toBeGreaterThan(0);
  });
});
