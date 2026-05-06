// Run with:  node --test scripts/__tests__/opencode-prompt.test.mjs
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  extractOpenCodeText,
  openCodePrompt,
  parseOpenCodeStdout,
} from "../lib/opencode-prompt.mjs";

describe("openCodePrompt", () => {
  it("rewrites /obelus:write-review with --out into out-of-band instructions", () => {
    const out = openCodePrompt("/obelus:write-review ./bundle.json --out");
    assert.match(out, /Read \.claude\/skills\/write-review\/SKILL\.md/);
    assert.match(out, /Out-of-band mode/);
    assert.match(out, /OBELUS_WROTE: <absolute-path-to-that-file>/);
    assert.doesNotMatch(out, /Inline mode/);
  });

  it("rewrites /obelus:write-review without --out into inline-mode instructions", () => {
    const out = openCodePrompt("/obelus:write-review ./bundle.json");
    assert.match(out, /Inline mode/);
    // The inline sentence names OBELUS_WROTE in its negation ("do NOT emit any
    // `OBELUS_WROTE:` marker"); the load-bearing absence is the path-write
    // requirement that the out-of-band branch carries.
    assert.doesNotMatch(out, /<absolute-path-to-that-file>/);
  });

  it("rewrites /obelus:apply-revision into a plan-write instruction", () => {
    const out = openCodePrompt("/obelus:apply-revision ./bundle.json");
    assert.match(out, /Read \.claude\/skills\/apply-revision\/SKILL\.md/);
    assert.match(out, /Write the plan as `plan-<iso>\.json`/);
    assert.match(out, /OBELUS_WROTE: <absolute-path-to-that-file>/);
  });

  it("rewrites /obelus:fix-compile into a plan-write instruction", () => {
    const out = openCodePrompt("/obelus:fix-compile ./error.json");
    assert.match(out, /Read \.claude\/skills\/fix-compile\/SKILL\.md/);
    assert.match(out, /Write the plan as `plan-<iso>\.json`/);
  });

  it("normalises an em-dash continuation that chains a /skill call", () => {
    const out = openCodePrompt(
      "/obelus:apply-revision ./bundle.json — then call /skill apply-fix on the resulting plan",
    );
    assert.match(
      out,
      /the `apply-fix` skill \(read \.claude\/skills\/apply-fix\/SKILL\.md inside this directory\)/,
    );
    assert.doesNotMatch(out, /\/skill apply-fix/);
  });

  it("returns non-matching prompts unchanged (modulo trim)", () => {
    assert.strictEqual(openCodePrompt("hello world"), "hello world");
    assert.strictEqual(openCodePrompt("  hello world  "), "hello world");
  });
});

describe("extractOpenCodeText", () => {
  it("returns the text field of a top-level text event", () => {
    assert.strictEqual(extractOpenCodeText({ type: "text", text: "hi" }), "hi");
  });

  it("concatenates text blocks inside an assistant.content array", () => {
    const obj = {
      role: "assistant",
      content: [
        { type: "text", text: "one " },
        { type: "tool_use", name: "Read" },
        { type: "text", text: "two" },
      ],
    };
    assert.strictEqual(extractOpenCodeText(obj), "one two");
  });

  it("supports the assistant.message.content shape", () => {
    const obj = {
      type: "assistant",
      message: { content: [{ type: "text", text: "nested" }] },
    };
    assert.strictEqual(extractOpenCodeText(obj), "nested");
  });

  it("returns empty string when no text content is present", () => {
    assert.strictEqual(extractOpenCodeText({ type: "tool_use" }), "");
    assert.strictEqual(
      extractOpenCodeText({ role: "assistant", content: [{ type: "tool_use" }] }),
      "",
    );
  });
});

describe("parseOpenCodeStdout", () => {
  it("returns an empty envelope for empty input", () => {
    assert.deepStrictEqual(parseOpenCodeStdout(""), { result: "", is_error: false });
  });

  it("concatenates assistant text across NDJSON lines", () => {
    const lines = [
      JSON.stringify({ type: "text", text: "one " }),
      JSON.stringify({ type: "tool_use", name: "Read" }),
      JSON.stringify({ role: "assistant", content: [{ type: "text", text: "two" }] }),
    ].join("\n");
    assert.deepStrictEqual(parseOpenCodeStdout(lines), {
      result: "one two",
      is_error: false,
    });
  });

  it("flips is_error when any event signals an error", () => {
    const lines = [
      JSON.stringify({ type: "text", text: "ok" }),
      JSON.stringify({ type: "error", message: "boom" }),
    ].join("\n");
    assert.deepStrictEqual(parseOpenCodeStdout(lines), {
      result: "ok",
      is_error: true,
    });
  });

  it("ignores non-JSON noise interleaved with NDJSON", () => {
    const lines = [
      "[opencode] starting",
      JSON.stringify({ type: "text", text: "hi" }),
      "log: malformed { not-json",
    ].join("\n");
    assert.deepStrictEqual(parseOpenCodeStdout(lines), {
      result: "hi",
      is_error: false,
    });
  });
});
