import { describe, expect, it } from "vitest";
import { extractModel, extractUsage, type ParsedStreamEvent, parseStreamLine } from "../index";

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
