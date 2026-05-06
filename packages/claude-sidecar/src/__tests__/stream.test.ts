import { describe, expect, it } from "vitest";
import {
  extractAssistantText,
  extractDeltaText,
  extractDeltaThinking,
  extractModel,
  extractThinkingText,
  extractToolUses,
  extractUsage,
  isResult,
  type ParsedStreamEvent,
  parseOpenCodeModelLogLine,
  parseStreamLine,
  parseToolResults,
} from "../index";

function mustParse(line: string): ParsedStreamEvent {
  const parsed = parseStreamLine(line);
  if (!parsed) throw new Error(`parseStreamLine returned null for: ${line}`);
  return parsed;
}

describe("extractUsage", () => {
  it("pulls usage from a terminal result event", () => {
    const parsed = mustParse(
      JSON.stringify({
        type: "result",
        subtype: "success",
        duration_ms: 12345,
        usage: {
          input_tokens: 4201,
          cache_read_input_tokens: 800,
          cache_creation_input_tokens: 100,
          output_tokens: 513,
        },
      }),
    );
    expect(extractUsage(parsed)).toEqual({
      inputTokens: 4201,
      cacheReadInputTokens: 800,
      cacheCreationInputTokens: 100,
      outputTokens: 513,
    });
  });

  it("pulls usage from a nested assistant.message.usage", () => {
    const parsed = mustParse(
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_01",
          model: "claude-sonnet-4-6",
          role: "assistant",
          content: [{ type: "text", text: "ok" }],
          usage: {
            input_tokens: 120,
            output_tokens: 33,
          },
        },
      }),
    );
    expect(extractUsage(parsed)).toEqual({
      inputTokens: 120,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      outputTokens: 33,
    });
  });

  it("returns null when no usage is present", () => {
    const parsed = mustParse(
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_stop", index: 0 },
      }),
    );
    expect(extractUsage(parsed)).toBeNull();
  });
});

describe("extractModel", () => {
  it("pulls model from assistant.message.model", () => {
    const parsed = mustParse(
      JSON.stringify({
        type: "assistant",
        message: { model: "claude-haiku-4-5-20251001", content: [] },
      }),
    );
    expect(extractModel(parsed)).toBe("claude-haiku-4-5-20251001");
  });

  it("pulls model from a top-level field when present", () => {
    const parsed = mustParse(JSON.stringify({ type: "system", model: "sonnet" }));
    expect(extractModel(parsed)).toBe("sonnet");
  });

  it("returns null when no model field is present", () => {
    const parsed = mustParse(
      JSON.stringify({ type: "stream_event", event: { type: "message_start" } }),
    );
    expect(extractModel(parsed)).toBeNull();
  });
});

describe("opencode normalisation", () => {
  it("normalises an opencode tool_use into a Claude-shaped assistant event", () => {
    const parsed = mustParse(
      JSON.stringify({
        type: "tool_use",
        timestamp: 1778066003981,
        sessionID: "ses_x",
        part: {
          type: "tool",
          tool: "read",
          callID: "toolu_x",
          state: {
            status: "completed",
            input: { filePath: "/tmp/readme.txt" },
            output: "...",
          },
        },
      }),
    );
    expect(parsed.type).toBe("assistant");
    const tools = extractToolUses(parsed);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("Read");
    expect(tools[0]?.input).toEqual({ filePath: "/tmp/readme.txt" });
  });

  it("title-cases compound tool names (multiedit → MultiEdit)", () => {
    const parsed = mustParse(
      JSON.stringify({
        type: "tool_use",
        part: { type: "tool", tool: "multiedit", state: { input: { filePath: "x" } } },
      }),
    );
    expect(extractToolUses(parsed)[0]?.name).toBe("MultiEdit");
  });

  it("falls back to capitalising unknown tool names", () => {
    const parsed = mustParse(
      JSON.stringify({
        type: "tool_use",
        part: { type: "tool", tool: "myCustomTool", state: { input: {} } },
      }),
    );
    expect(extractToolUses(parsed)[0]?.name).toBe("MyCustomTool");
  });

  it("normalises an opencode text event into assistant text", () => {
    const parsed = mustParse(
      JSON.stringify({
        type: "text",
        sessionID: "ses_x",
        part: { type: "text", text: "OBELUS_WROTE: /tmp/plan.json" },
      }),
    );
    expect(parsed.type).toBe("assistant");
    expect(extractAssistantText(parsed)).toBe("OBELUS_WROTE: /tmp/plan.json");
  });

  it("step_finish with reason=stop becomes a result event with usage", () => {
    const parsed = mustParse(
      JSON.stringify({
        type: "step_finish",
        part: {
          reason: "stop",
          tokens: {
            total: 22478,
            input: 6,
            output: 144,
            reasoning: 0,
            cache: { write: 192, read: 22136 },
          },
          cost: 0,
        },
      }),
    );
    expect(isResult(parsed)).toBe(true);
    expect(extractUsage(parsed)).toEqual({
      inputTokens: 6,
      outputTokens: 144,
      cacheReadInputTokens: 22136,
      cacheCreationInputTokens: 192,
    });
  });

  it("step_finish with reason=tool-calls keeps usage as a mid-stream assistant event", () => {
    const parsed = mustParse(
      JSON.stringify({
        type: "step_finish",
        part: {
          reason: "tool-calls",
          tokens: { input: 6, output: 61, cache: { write: 22011, read: 0 } },
        },
      }),
    );
    expect(parsed.type).toBe("assistant");
    expect(isResult(parsed)).toBe(false);
    expect(extractUsage(parsed)).toEqual({
      inputTokens: 6,
      outputTokens: 61,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 22011,
    });
  });

  it("step_start passes through as a typed event with no extracted text", () => {
    const parsed = mustParse(JSON.stringify({ type: "step_start", part: { type: "step-start" } }));
    expect(parsed.type).toBe("step_start");
    expect(extractAssistantText(parsed)).toBe("");
    expect(extractToolUses(parsed)).toEqual([]);
    // OpenCode does not embed model info in step_start parts; the resolved
    // provider+model arrives via stderr (see parseOpenCodeModelLogLine).
    expect(extractModel(parsed)).toBeNull();
  });
});

describe("extractThinkingText", () => {
  it("concatenates text from thinking blocks in an assistant message", () => {
    const parsed = mustParse(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: "First, I need to understand " },
            { type: "thinking", thinking: "what the author is claiming." },
            { type: "text", text: "Reviewing section 3…" },
          ],
        },
      }),
    );
    expect(extractThinkingText(parsed)).toBe(
      "First, I need to understand what the author is claiming.",
    );
  });

  it("returns empty string when no thinking blocks are present", () => {
    const parsed = mustParse(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "ok" }] },
      }),
    );
    expect(extractThinkingText(parsed)).toBe("");
  });

  it("returns empty string for non-assistant events", () => {
    const parsed = mustParse(
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_stop", index: 0 },
      }),
    );
    expect(extractThinkingText(parsed)).toBe("");
  });
});

describe("extractDeltaThinking", () => {
  it("pulls thinking from thinking_delta in a stream_event", () => {
    const parsed = mustParse(
      JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "weighing two readings" },
        },
      }),
    );
    expect(extractDeltaThinking(parsed)).toBe("weighing two readings");
  });

  it("does not match text_delta events", () => {
    const parsed = mustParse(
      JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "prose" },
        },
      }),
    );
    expect(extractDeltaThinking(parsed)).toBe("");
    expect(extractDeltaText(parsed)).toBe("prose");
  });

  it("returns empty string for non-stream_event events", () => {
    const parsed = mustParse(JSON.stringify({ type: "result", subtype: "success" }));
    expect(extractDeltaThinking(parsed)).toBe("");
  });
});

describe("parseToolResults", () => {
  it("extracts tool_result blocks from a user event with string content", () => {
    const parsed = mustParse(
      JSON.stringify({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_01",
              content: "Found 12 matches",
            },
          ],
        },
      }),
    );
    const results = parseToolResults(parsed);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      toolUseId: "toolu_01",
      content: "Found 12 matches",
      isError: false,
    });
  });

  it("flattens an array-of-text content payload", () => {
    const parsed = mustParse(
      JSON.stringify({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_02",
              content: [
                { type: "text", text: "line one\n" },
                { type: "text", text: "line two" },
              ],
            },
          ],
        },
      }),
    );
    expect(parseToolResults(parsed)[0]?.content).toBe("line one\nline two");
  });

  it("marks error results", () => {
    const parsed = mustParse(
      JSON.stringify({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_03",
              is_error: true,
              content: "permission denied",
            },
          ],
        },
      }),
    );
    expect(parseToolResults(parsed)[0]?.isError).toBe(true);
  });

  it("returns empty for events with no tool_result blocks", () => {
    const parsed = mustParse(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "hi" }] },
      }),
    );
    expect(parseToolResults(parsed)).toEqual([]);
  });
});

describe("parseOpenCodeModelLogLine", () => {
  it("extracts provider/model from the workhorse llm log line", () => {
    const line =
      "INFO  2026-05-06T11:46:27 +1ms service=llm providerID=anthropic modelID=claude-sonnet-4-5-20250929 sessionID=ses_x small=false agent=build mode=primary stream";
    expect(parseOpenCodeModelLogLine(line)).toBe("anthropic/claude-sonnet-4-5-20250929");
  });

  it("ignores the small=true title-summariser line", () => {
    const line =
      "INFO  2026-05-06T11:46:27 +1ms service=llm providerID=opencode modelID=gpt-5-nano sessionID=ses_x small=true agent=title mode=primary stream";
    expect(parseOpenCodeModelLogLine(line)).toBeNull();
  });

  it("returns just the model when the providerID token is absent", () => {
    const line = "INFO ... service=llm modelID=gpt-5 small=false agent=build";
    expect(parseOpenCodeModelLogLine(line)).toBe("gpt-5");
  });

  it("returns null on unrelated log lines", () => {
    expect(parseOpenCodeModelLogLine("INFO  ... service=provider init")).toBeNull();
    expect(parseOpenCodeModelLogLine("Reading main.typ")).toBeNull();
  });
});
