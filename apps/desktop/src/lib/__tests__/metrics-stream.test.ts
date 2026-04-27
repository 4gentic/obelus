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

  it("task-call uses toolUseResult.usage when present", () => {
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
                name: "Task",
                input: {
                  subagent_type: "obelus:paper-reviewer",
                  description: "Stress-test 3 marks",
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
            content: [{ type: "tool_result", tool_use_id: "tu_task_tur", content: "..." }],
          },
          toolUseResult: {
            status: "completed",
            agentType: "obelus:paper-reviewer",
            totalDurationMs: 121962,
            totalTokens: 33929,
            usage: {
              input_tokens: 4500,
              output_tokens: 1200,
              cache_read_input_tokens: 31528,
              cache_creation_input_tokens: 1251,
            },
          },
        }),
        at: startedAt + 8_000,
      },
    ]);
    const task = drained.find((e) => e.event === "task-call");
    if (task?.event !== "task-call") throw new Error("typeguard");
    expect(task.agent).toBe("obelus:paper-reviewer");
    expect(task.inputTokens).toBe(4_500);
    expect(task.outputTokens).toBe(1_200);
  });

  it("task-call agent name comes from toolUseResult.agentType when subagent_type input is missing", () => {
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
                // the tool_use input; the user event's toolUseResult.agentType
                // is the fallback signal.
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
          toolUseResult: {
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

  it("task-call falls back to parent-turn delta when no toolUseResult", () => {
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
