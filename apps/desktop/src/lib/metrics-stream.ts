// WS3 stream-json → metric events. The jobs-listener owns the live stream;
// this module is the pure state machine that turns one parsed event (plus a
// stdout line for phase markers) into zero-or-more `MetricEvent`s.
//
// Kept stateful per session: the caller (jobs-listener) creates one tracker
// at session start and feeds it every stdout event in order, then calls
// `finalize()` when the subprocess exits.
//
// Pure of side effects on purpose: tests feed a recorded fixture and assert on
// the emitted events without mocking Tauri.

import {
  extractAssistantText,
  extractResultText,
  type ParsedStreamEvent,
} from "@obelus/claude-sidecar";
import { type MetricEvent, summariseToolInput } from "./metrics";

// The marker is emitted as bare-line text inside an assistant text block (not
// as a stdout line — stream-json wraps every turn in JSON). Mirrors
// `claude-phase.ts::PHASE_MARKER_RE`.
const PHASE_MARKER_RE = /\[obelus:phase\]\s+(\S+)/;

// Plugin contract: the very first phase opens at session start. Use a sentinel
// name so a metrics consumer can tell "everything before the first
// [obelus:phase]" from the real phases the skill committed to.
export const PRE_PHASE_NAME = "<pre-phase>";

interface PendingToolUse {
  id: string;
  name: string;
  input: unknown;
  phase: string;
  startedAt: number;
  // Cumulative usage *just before* this tool_use turn. The Task delta is the
  // total tokens at tool_result minus this snapshot.
  parentInputTokens: number;
  parentOutputTokens: number;
}

interface PhaseAccumulator {
  name: string;
  startedAt: number;
  startedAtIso: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
}

export interface MetricsStreamOptions {
  sessionId: string;
  // Wall-clock at session start. The pre-phase opens here.
  startedAt: number;
  startedAtIso: string;
}

// Total cumulative tokens this session has seen, regardless of phase. Used
// for Task input/output deltas: the SDK does not nest per-Task usage in the
// tool_result, but the parent assistant turn's running totals do reflect the
// Task's contribution once it returns.
interface SessionTotals {
  inputTokens: number;
  outputTokens: number;
}

export class MetricsStream {
  private readonly sessionId: string;
  private phase: PhaseAccumulator;
  private readonly pending = new Map<string, PendingToolUse>();
  private readonly totals: SessionTotals = { inputTokens: 0, outputTokens: 0 };
  private finalized = false;
  private readonly emitted: MetricEvent[] = [];

  constructor(opts: MetricsStreamOptions) {
    this.sessionId = opts.sessionId;
    this.phase = {
      name: PRE_PHASE_NAME,
      startedAt: opts.startedAt,
      startedAtIso: opts.startedAtIso,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
    };
  }

  // Drain and clear the queue. Tests use this after each step.
  drain(): MetricEvent[] {
    const out = this.emitted.splice(0, this.emitted.length);
    return out;
  }

  // Feed one parsed event. The phase marker is detected from extracted
  // assistant/result text (plain stdout lines are stream-json JSON objects,
  // so the marker only ever appears inside a parsed event).
  ingest(parsed: ParsedStreamEvent | null, atMs: number, atIso: string): void {
    if (this.finalized) return;
    if (parsed) {
      const marker = extractMarker(parsed);
      if (marker !== null) {
        this.closePhase(atMs, atIso);
        this.phase = {
          name: marker,
          startedAt: atMs,
          startedAtIso: atIso,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreateTokens: 0,
        };
      }
      this.ingestParsed(parsed, atMs, atIso);
    }
  }

  private ingestParsed(parsed: ParsedStreamEvent, atMs: number, atIso: string): void {
    const message = (parsed.raw as { message?: unknown }).message;
    if (parsed.type === "assistant") {
      const usage = readUsage(message);
      if (usage) {
        this.phase.inputTokens += usage.input;
        this.phase.outputTokens += usage.output;
        this.phase.cacheReadTokens += usage.cacheRead;
        this.phase.cacheCreateTokens += usage.cacheCreate;
        this.totals.inputTokens += usage.input;
        this.totals.outputTokens += usage.output;
      }
      const blocks = readContent(message);
      for (const block of blocks) {
        if (block.type !== "tool_use") continue;
        const id = typeof block.id === "string" ? block.id : null;
        const name = typeof block.name === "string" ? block.name : null;
        if (!id || !name) continue;
        this.pending.set(id, {
          id,
          name,
          input: block.input,
          phase: this.phase.name,
          startedAt: atMs,
          parentInputTokens: this.totals.inputTokens,
          parentOutputTokens: this.totals.outputTokens,
        });
      }
      return;
    }
    if (parsed.type === "user") {
      const blocks = readContent(message);
      for (const block of blocks) {
        if (block.type !== "tool_result") continue;
        const id = typeof block.tool_use_id === "string" ? block.tool_use_id : null;
        if (!id) continue;
        const pending = this.pending.get(id);
        if (!pending) continue;
        this.pending.delete(id);
        const durationMs = Math.max(0, atMs - pending.startedAt);
        // Key on `subagent_type` rather than the tool name. Different Claude
        // Code releases have shipped this as `Task` and `Agent`; the input
        // payload's `subagent_type` is the stable signal for "this is a
        // subagent invocation, not a leaf tool call".
        const agent = readSubagentType(pending.input);
        if (agent !== "") {
          const inputDelta = Math.max(0, this.totals.inputTokens - pending.parentInputTokens);
          const outputDelta = Math.max(0, this.totals.outputTokens - pending.parentOutputTokens);
          const nestedUsage = readNestedTaskUsage(block);
          this.emitted.push({
            event: "task-call",
            at: atIso,
            sessionId: this.sessionId,
            phase: pending.phase,
            agent,
            durationMs,
            inputTokens: nestedUsage?.input ?? inputDelta,
            outputTokens: nestedUsage?.output ?? outputDelta,
          });
        } else {
          this.emitted.push({
            event: "tool-call",
            at: atIso,
            sessionId: this.sessionId,
            phase: pending.phase,
            name: pending.name,
            input: summariseToolInput(pending.input),
            durationMs,
          });
        }
      }
    }
  }

  // Close the current phase and emit `phase` + `phase-tokens`. Idempotent:
  // calling twice is a no-op past the first.
  finalize(atMs: number, atIso: string): void {
    if (this.finalized) return;
    this.closePhase(atMs, atIso);
    this.finalized = true;
  }

  private closePhase(endMs: number, endIso: string): void {
    const durationMs = Math.max(0, endMs - this.phase.startedAt);
    this.emitted.push({
      event: "phase",
      at: endIso,
      sessionId: this.sessionId,
      name: this.phase.name,
      startedAt: this.phase.startedAtIso,
      endedAt: endIso,
      durationMs,
    });
    this.emitted.push({
      event: "phase-tokens",
      at: endIso,
      sessionId: this.sessionId,
      name: this.phase.name,
      inputTokens: this.phase.inputTokens,
      outputTokens: this.phase.outputTokens,
      cacheReadTokens: this.phase.cacheReadTokens,
      cacheCreateTokens: this.phase.cacheCreateTokens,
    });
  }
}

function extractMarker(event: ParsedStreamEvent): string | null {
  const text = extractAssistantText(event) || extractResultText(event) || "";
  if (!text) return null;
  const m = text.match(PHASE_MARKER_RE);
  return m?.[1] ?? null;
}

// Exposed for tests that want to assert the marker regex directly.
export function matchPhaseMarkerInText(text: string): string | null {
  const m = text.match(PHASE_MARKER_RE);
  return m?.[1] ?? null;
}

interface UsageNumbers {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
}

function readUsage(message: unknown): UsageNumbers | null {
  if (!message || typeof message !== "object") return null;
  const usage = (message as Record<string, unknown>).usage;
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  return {
    input: numberAt(u, "input_tokens"),
    output: numberAt(u, "output_tokens"),
    cacheRead: numberAt(u, "cache_read_input_tokens"),
    cacheCreate: numberAt(u, "cache_creation_input_tokens"),
  };
}

function numberAt(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function readContent(message: unknown): ReadonlyArray<Record<string, unknown>> {
  if (!message || typeof message !== "object") return [];
  const content = (message as Record<string, unknown>).content;
  if (!Array.isArray(content)) return [];
  return content.filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null);
}

function readSubagentType(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const v = (input as Record<string, unknown>).subagent_type;
  return typeof v === "string" ? v : "";
}

// Some Claude Code releases include an `usage` object inside the tool_result
// payload for Task calls (the subagent's own session totals). Pull it if the
// runtime supplies it; otherwise the caller falls back to the parent-turn
// delta.
function readNestedTaskUsage(
  block: Record<string, unknown>,
): { input: number; output: number } | null {
  const content = block.content;
  if (!content) return null;
  if (Array.isArray(content)) {
    for (const entry of content) {
      if (!entry || typeof entry !== "object") continue;
      const usage = (entry as Record<string, unknown>).usage;
      if (usage && typeof usage === "object") {
        const u = usage as Record<string, unknown>;
        return { input: numberAt(u, "input_tokens"), output: numberAt(u, "output_tokens") };
      }
    }
  } else if (typeof content === "object") {
    const usage = (content as Record<string, unknown>).usage;
    if (usage && typeof usage === "object") {
      const u = usage as Record<string, unknown>;
      return { input: numberAt(u, "input_tokens"), output: numberAt(u, "output_tokens") };
    }
  }
  return null;
}
