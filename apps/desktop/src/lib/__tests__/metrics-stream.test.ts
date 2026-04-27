import { parseStreamLine } from "@obelus/claude-sidecar";
import { describe, expect, it } from "vitest";
import type { MetricEvent } from "../metrics";
import { MetricsStream, PRE_PHASE_NAME } from "../metrics-stream";

const SESSION = "abc123";

interface ScriptedLine {
  line: string;
  // Wall-clock ms since session start, increasing.
  at: number;
}

function feed(stream: MetricsStream, scripted: ReadonlyArray<ScriptedLine>): MetricEvent[] {
  for (const { line, at } of scripted) {
    const parsed = parseStreamLine(line);
    stream.ingest(parsed, at, isoFromMs(at));
  }
  return stream.drain();
}

function isoFromMs(ms: number): string {
  return new Date(ms).toISOString();
}

function asJsonl(obj: unknown): string {
  return JSON.stringify(obj);
}

describe("MetricsStream", () => {
  const startedAt = 1_700_000_000_000;

  function fresh(): MetricsStream {
    return new MetricsStream({
      sessionId: SESSION,
      startedAt,
      startedAtIso: isoFromMs(startedAt),
    });
  }

  it("opens at <pre-phase>; phase markers close the previous phase", () => {
    const stream = fresh();
    const startup = feed(stream, [
      // Startup narration before the first marker — counts toward <pre-phase>.
      {
        line: asJsonl({
          type: "assistant",
          message: { content: [{ type: "text", text: "Reading the bundle..." }] },
        }),
        at: startedAt + 200,
      },
      // First marker arrives.
      {
        line: asJsonl({
          type: "assistant",
          message: { content: [{ type: "text", text: "[obelus:phase] locating-spans" }] },
        }),
        at: startedAt + 1_000,
      },
    ]);

    // Closing <pre-phase> emits `phase` and `phase-tokens` for it.
    expect(startup.map((e) => e.event)).toEqual(["phase", "phase-tokens"]);
    const phase = startup[0];
    expect(phase?.event).toBe("phase");
    if (phase?.event !== "phase") throw new Error("typeguard");
    expect(phase.name).toBe(PRE_PHASE_NAME);
    expect(phase.durationMs).toBe(1_000);

    // Second marker fires; previous phase was `locating-spans`.
    const drained2 = feed(stream, [
      {
        line: asJsonl({
          type: "assistant",
          message: { content: [{ type: "text", text: "[obelus:phase] stress-test" }] },
        }),
        at: startedAt + 4_000,
      },
    ]);
    const phase2 = drained2[0];
    expect(phase2?.event).toBe("phase");
    if (phase2?.event !== "phase") throw new Error("typeguard");
    expect(phase2.name).toBe("locating-spans");
    expect(phase2.durationMs).toBe(3_000);

    // Finalize closes the active phase.
    stream.finalize(startedAt + 6_000, isoFromMs(startedAt + 6_000));
    const final = stream.drain();
    const finalPhase = final[0];
    if (finalPhase?.event !== "phase") throw new Error("typeguard");
    expect(finalPhase.name).toBe("stress-test");
    expect(finalPhase.durationMs).toBe(2_000);
  });

  it("matches tool_use to tool_result and emits a tool-call", () => {
    const stream = fresh();
    feed(stream, [
      {
        line: asJsonl({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "tu_1",
                name: "Read",
                input: { file_path: "/abs/path/to/paper.tex", limit: 200 },
              },
            ],
          },
        }),
        at: startedAt + 500,
      },
    ]);
    const drained = feed(stream, [
      {
        line: asJsonl({
          type: "user",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "tu_1",
                content: "file contents...",
              },
            ],
          },
        }),
        at: startedAt + 1_400,
      },
    ]);

    const tool = drained.find((e) => e.event === "tool-call");
    expect(tool).toBeDefined();
    if (tool?.event !== "tool-call") throw new Error("typeguard");
    expect(tool.name).toBe("Read");
    expect(tool.phase).toBe(PRE_PHASE_NAME);
    expect(tool.durationMs).toBe(900);
    expect(tool.input).toContain("paper.tex");
  });

  it("attributes a tool-call to the phase active when the tool_use was emitted", () => {
    const stream = fresh();
    // Open phase A, fire a tool_use inside A, transition to B, then close
    // the tool with tool_result. The tool-call must carry phase A.
    feed(stream, [
      {
        line: asJsonl({
          type: "assistant",
          message: { content: [{ type: "text", text: "[obelus:phase] alpha" }] },
        }),
        at: startedAt + 100,
      },
      {
        line: asJsonl({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "tu_2",
                name: "Glob",
                input: { pattern: "**/*.tex" },
              },
            ],
          },
        }),
        at: startedAt + 200,
      },
      {
        line: asJsonl({
          type: "assistant",
          message: { content: [{ type: "text", text: "[obelus:phase] beta" }] },
        }),
        at: startedAt + 600,
      },
    ]);
    const drained = feed(stream, [
      {
        line: asJsonl({
          type: "user",
          message: {
            content: [{ type: "tool_result", tool_use_id: "tu_2", content: "..." }],
          },
        }),
        at: startedAt + 800,
      },
    ]);
    const tool = drained.find((e) => e.event === "tool-call");
    if (tool?.event !== "tool-call") throw new Error("typeguard");
    expect(tool.phase).toBe("alpha");
    expect(tool.name).toBe("Glob");
  });

  it("task-call uses tool_use_result.usage when present (live wire shape)", () => {
    // Fixture matches the actual wire shape captured from
    // `claude --print --output-format stream-json --include-partial-messages`:
    // the user event that closes a Task tool_use carries a sibling
    // `tool_use_result` (snake_case) field with `usage`, `agentType`,
    // `totalTokens`, etc. The persisted on-disk transcript at
    // ~/.claude/projects/<sid>.jsonl uses camelCase `toolUseResult` for the
    // same payload — we accept both, but the live spawn only ever sees the
    // snake_case form.
    const stream = fresh();
    feed(stream, [
      {
        line: asJsonl({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "tu_task_tur",
                name: "Agent",
                input: {
                  subagent_type: "obelus:paper-reviewer",
                  description: "Stress-test 6 plan blocks",
                  prompt: "...",
                },
              },
            ],
          },
        }),
        at: startedAt + 100,
      },
    ]);
    const drained = feed(stream, [
      {
        line: asJsonl({
          type: "user",
          message: {
            content: [
              {
                tool_use_id: "tu_task_tur",
                type: "tool_result",
                content: [{ type: "text", text: "**489230f0** — ..." }],
              },
            ],
          },
          tool_use_result: {
            status: "completed",
            prompt: "...",
            agentId: "a14cdac215f732793",
            agentType: "obelus:paper-reviewer",
            content: [{ type: "text", text: "**489230f0** — ..." }],
            totalDurationMs: 23518,
            totalTokens: 11096,
            totalToolUseCount: 0,
            usage: {
              input_tokens: 3,
              cache_creation_input_tokens: 10510,
              cache_read_input_tokens: 0,
              output_tokens: 583,
            },
          },
        }),
        at: startedAt + 8_000,
      },
    ]);
    const task = drained.find((e) => e.event === "task-call");
    if (task?.event !== "task-call") throw new Error("typeguard");
    expect(task.agent).toBe("obelus:paper-reviewer");
    expect(task.inputTokens).toBe(3);
    expect(task.outputTokens).toBe(583);
  });

  it("task-call also accepts the camelCase toolUseResult shape (on-disk transcript)", () => {
    const stream = fresh();
    feed(stream, [
      {
        line: asJsonl({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "tu_task_camel",
                name: "Agent",
                input: { subagent_type: "obelus:paper-reviewer" },
              },
            ],
          },
        }),
        at: startedAt + 100,
      },
    ]);
    const drained = feed(stream, [
      {
        line: asJsonl({
          type: "user",
          message: {
            content: [{ type: "tool_result", tool_use_id: "tu_task_camel", content: "..." }],
          },
          toolUseResult: {
            status: "completed",
            agentType: "obelus:paper-reviewer",
            usage: { input_tokens: 7, output_tokens: 42 },
          },
        }),
        at: startedAt + 8_000,
      },
    ]);
    const task = drained.find((e) => e.event === "task-call");
    if (task?.event !== "task-call") throw new Error("typeguard");
    expect(task.inputTokens).toBe(7);
    expect(task.outputTokens).toBe(42);
  });

  it("task-call agent name comes from tool_use_result.agentType when subagent_type input is missing", () => {
    const stream = fresh();
    feed(stream, [
      {
        line: asJsonl({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "tu_task_no_subagent",
                name: "Task",
                // Newer Claude Code releases sometimes drop subagent_type from
                // the tool_use input; the user event's tool_use_result
                // .agentType is the fallback signal.
                input: { description: "Stress-test 3 marks" },
              },
            ],
          },
        }),
        at: startedAt + 100,
      },
    ]);
    const drained = feed(stream, [
      {
        line: asJsonl({
          type: "user",
          message: {
            content: [{ type: "tool_result", tool_use_id: "tu_task_no_subagent", content: "..." }],
          },
          tool_use_result: {
            status: "completed",
            agentType: "obelus:cascade-judge",
            usage: { input_tokens: 100, output_tokens: 50 },
          },
        }),
        at: startedAt + 8_000,
      },
    ]);
    const task = drained.find((e) => e.event === "task-call");
    expect(task).toBeDefined();
    if (task?.event !== "task-call") throw new Error("typeguard");
    expect(task.agent).toBe("obelus:cascade-judge");
    expect(task.inputTokens).toBe(100);
    expect(task.outputTokens).toBe(50);
  });

  it("task-call falls back to parent-turn delta when no tool_use_result", () => {
    const stream = fresh();
    feed(stream, [
      {
        line: asJsonl({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "tu_task",
                name: "Agent",
                input: {
                  subagent_type: "obelus:paper-reviewer",
                  description: "Stress-test 3 marks",
                },
              },
            ],
            usage: {
              input_tokens: 1_000,
              output_tokens: 200,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
          },
        }),
        at: startedAt + 100,
      },
      // While the Task is running, the parent assistant turn accumulates.
      {
        line: asJsonl({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "..." }],
            usage: {
              input_tokens: 1_500,
              output_tokens: 600,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
          },
        }),
        at: startedAt + 5_000,
      },
    ]);
    const drained = feed(stream, [
      {
        line: asJsonl({
          type: "user",
          message: {
            content: [{ type: "tool_result", tool_use_id: "tu_task", content: "..." }],
          },
        }),
        at: startedAt + 8_000,
      },
    ]);
    const task = drained.find((e) => e.event === "task-call");
    expect(task).toBeDefined();
    if (task?.event !== "task-call") throw new Error("typeguard");
    expect(task.agent).toBe("obelus:paper-reviewer");
    expect(task.durationMs).toBe(7_900);
    // Task delta = totals at tool_result minus totals at tool_use.
    // Pre-Task totals: 1000 in / 200 out. After: 2500 in / 800 out
    // (1000 + 1500 from the parent turn that ran concurrently). Delta:
    // 1500 in, 600 out.
    expect(task.inputTokens).toBe(1_500);
    expect(task.outputTokens).toBe(600);
  });

  it("phase tokens summed across the phase's assistant events", () => {
    const stream = fresh();
    const events = feed(stream, [
      // <pre-phase> opens at ctor; first marker closes it.
      {
        line: asJsonl({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "[obelus:phase] alpha" }],
            usage: {
              input_tokens: 5,
              output_tokens: 5,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
          },
        }),
        at: startedAt + 100,
      },
      {
        line: asJsonl({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "..." }],
            usage: {
              input_tokens: 100,
              output_tokens: 50,
              cache_read_input_tokens: 25,
              cache_creation_input_tokens: 10,
            },
          },
        }),
        at: startedAt + 200,
      },
      {
        line: asJsonl({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "[obelus:phase] beta" }],
            usage: {
              input_tokens: 30,
              output_tokens: 20,
              cache_read_input_tokens: 5,
              cache_creation_input_tokens: 0,
            },
          },
        }),
        at: startedAt + 1_000,
      },
    ]);

    // We saw two phase closures: <pre-phase> at the alpha marker, and alpha
    // at the beta marker. The alpha tokens should reflect: (5,5,0,0) from
    // the alpha marker line itself + (100,50,25,10) from the body event +
    // (30,20,5,0) from the beta marker line. Wait — no: a marker line
    // closes the *previous* phase before opening the new one. Tokens on the
    // marker line itself accrue to the *next* phase, since closePhase runs
    // before the parsed event is processed.
    //
    // Order of operations in `ingest`:
    //   1. matchPhaseMarker → closePhase → reset phase
    //   2. ingestParsed → adds usage to (now-new) phase
    //
    // So the alpha marker line's usage (5,5,0,0) goes into alpha. The beta
    // marker line's usage (30,20,5,0) goes into beta. alpha's tokens should
    // be (5+100, 5+50, 0+25, 0+10) = (105, 55, 25, 10).
    const phaseEvents = events.filter((e) => e.event === "phase-tokens");
    expect(phaseEvents).toHaveLength(2);
    const preTokens = phaseEvents.find(
      (e) => e.event === "phase-tokens" && e.name === PRE_PHASE_NAME,
    );
    if (preTokens?.event !== "phase-tokens") throw new Error("typeguard");
    expect(preTokens.inputTokens).toBe(0);

    const alphaTokens = phaseEvents.find((e) => e.event === "phase-tokens" && e.name === "alpha");
    if (alphaTokens?.event !== "phase-tokens") throw new Error("typeguard");
    expect(alphaTokens.inputTokens).toBe(105);
    expect(alphaTokens.outputTokens).toBe(55);
    expect(alphaTokens.cacheReadTokens).toBe(25);
    expect(alphaTokens.cacheCreateTokens).toBe(10);
  });

  it("synthesizes writing-plan when the model writes plan-*.json without a marker", () => {
    const stream = fresh();
    // Model emits coherence-sweep marker, does some thinking, then writes the
    // plan JSON without ever emitting `[obelus:phase] writing-plan`.
    feed(stream, [
      {
        line: asJsonl({
          type: "assistant",
          message: { content: [{ type: "text", text: "[obelus:phase] coherence-sweep" }] },
        }),
        at: startedAt + 1_000,
      },
      {
        line: asJsonl({
          type: "assistant",
          message: { content: [{ type: "text", text: "Composing the plan..." }] },
        }),
        at: startedAt + 60_000,
      },
    ]);
    const drained = feed(stream, [
      {
        line: asJsonl({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "tu_write_plan",
                name: "Write",
                input: {
                  file_path: "/<workspace>/projects/<id>/plan-20260427-172800.json",
                  content: "{}",
                },
              },
            ],
          },
        }),
        at: startedAt + 90_000,
      },
    ]);

    const phaseEvents = drained.filter((e) => e.event === "phase");
    expect(phaseEvents).toHaveLength(1);
    const closed = phaseEvents[0];
    if (closed?.event !== "phase") throw new Error("typeguard");
    expect(closed.name).toBe("coherence-sweep");
    expect(closed.durationMs).toBe(89_000);

    // Finalize to verify writing-plan opened with the Write timestamp.
    stream.finalize(startedAt + 92_000, isoFromMs(startedAt + 92_000));
    const final = stream.drain();
    const writingPlan = final.find((e) => e.event === "phase" && e.name === "writing-plan");
    if (writingPlan?.event !== "phase") throw new Error("typeguard");
    expect(writingPlan.durationMs).toBe(2_000);
  });

  it("does not synthesize writing-plan when the model already emitted the marker", () => {
    const stream = fresh();
    feed(stream, [
      {
        line: asJsonl({
          type: "assistant",
          message: { content: [{ type: "text", text: "[obelus:phase] writing-plan" }] },
        }),
        at: startedAt + 1_000,
      },
    ]);
    const drained = feed(stream, [
      {
        line: asJsonl({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "tu_write_plan_honest",
                name: "Write",
                input: {
                  file_path: "/<workspace>/plan-20260427-172800.json",
                  content: "{}",
                },
              },
            ],
          },
        }),
        at: startedAt + 5_000,
      },
    ]);
    // No new phase events between the marker and the Write — the synthetic
    // transition guards on `phase.name !== "writing-plan"`.
    expect(drained.filter((e) => e.event === "phase")).toHaveLength(0);
  });

  it("does not synthesize writing-plan for a non-plan Write", () => {
    const stream = fresh();
    feed(stream, [
      {
        line: asJsonl({
          type: "assistant",
          message: { content: [{ type: "text", text: "[obelus:phase] coherence-sweep" }] },
        }),
        at: startedAt + 1_000,
      },
    ]);
    const drained = feed(stream, [
      {
        line: asJsonl({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "tu_write_other",
                name: "Write",
                input: {
                  file_path: "/<workspace>/notes.md",
                  content: "...",
                },
              },
            ],
          },
        }),
        at: startedAt + 5_000,
      },
    ]);
    expect(drained.filter((e) => e.event === "phase")).toHaveLength(0);
  });

  it("synthesizes writing-plan for the deep-review variant plan-*-deep.json", () => {
    const stream = fresh();
    feed(stream, [
      {
        line: asJsonl({
          type: "assistant",
          message: { content: [{ type: "text", text: "[obelus:phase] coherence-sweep" }] },
        }),
        at: startedAt + 1_000,
      },
    ]);
    const drained = feed(stream, [
      {
        line: asJsonl({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "tu_write_deep",
                name: "Write",
                input: {
                  file_path: "/<workspace>/plan-20260427-172800-deep.json",
                  content: "{}",
                },
              },
            ],
          },
        }),
        at: startedAt + 5_000,
      },
    ]);
    const phaseEvents = drained.filter((e) => e.event === "phase");
    expect(phaseEvents).toHaveLength(1);
    if (phaseEvents[0]?.event !== "phase") throw new Error("typeguard");
    expect(phaseEvents[0].name).toBe("coherence-sweep");
  });

  it("ignores unmatched tool_result blocks (e.g. duplicates)", () => {
    const stream = fresh();
    const drained = feed(stream, [
      {
        line: asJsonl({
          type: "user",
          message: {
            content: [{ type: "tool_result", tool_use_id: "never-existed", content: "..." }],
          },
        }),
        at: startedAt + 500,
      },
    ]);
    expect(drained.filter((e) => e.event === "tool-call")).toHaveLength(0);
  });

  it("finalize is idempotent", () => {
    const stream = fresh();
    stream.finalize(startedAt + 100, isoFromMs(startedAt + 100));
    const first = stream.drain();
    expect(first.map((e) => e.event)).toEqual(["phase", "phase-tokens"]);
    stream.finalize(startedAt + 200, isoFromMs(startedAt + 200));
    expect(stream.drain()).toEqual([]);
  });
});
