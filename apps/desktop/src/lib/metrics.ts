import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

const Iso = z.string();

const BundleStatsEvent = z.object({
  event: z.literal("bundle-stats"),
  at: Iso,
  sessionId: z.string(),
  annotations: z.number().int().nonnegative(),
  anchorSource: z.number().int().nonnegative(),
  anchorPdf: z.number().int().nonnegative(),
  anchorHtml: z.number().int().nonnegative(),
  papers: z.number().int().nonnegative(),
  files: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  // Model + effort the run actually used. After WS4 the user can pick
  // non-default values via the Advanced disclosure on the start-review panel;
  // historical comparisons mix apples and oranges without these stamped per
  // event. Strings rather than enums so a future model/effort name does not
  // break replay of older metrics files.
  model: z.string(),
  effort: z.string(),
});

// Emitted by Rust right after the JSON Schema check passes (or, for a
// failure, *before* the spawn refusal — but failures abort the spawn, so the
// frontend never sees a session id and the event is only on the success
// path today). `errors` carries up to the first three error strings the
// validator produced, mirroring the Rust 3-error cap.
const BundleValidatedEvent = z.object({
  event: z.literal("bundle-validated"),
  at: Iso,
  sessionId: z.string(),
  validationMs: z.number().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  errors: z.array(z.string()).optional(),
});

const PreflightRustEvent = z.object({
  event: z.literal("preflight-rust"),
  at: Iso,
  sessionId: z.string(),
  preludeMs: z.number().nonnegative(),
  sha256Ms: z.number().nonnegative(),
  totalMs: z.number().nonnegative(),
});

const PhaseEvent = z.object({
  event: z.literal("phase"),
  at: Iso,
  sessionId: z.string(),
  name: z.string(),
  startedAt: Iso,
  endedAt: Iso,
  durationMs: z.number().nonnegative(),
});

const PhaseTokensEvent = z.object({
  event: z.literal("phase-tokens"),
  at: Iso,
  sessionId: z.string(),
  name: z.string(),
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  cacheReadTokens: z.number().nonnegative(),
  cacheCreateTokens: z.number().nonnegative(),
});

const ToolCallEvent = z.object({
  event: z.literal("tool-call"),
  at: Iso,
  sessionId: z.string(),
  phase: z.string(),
  name: z.string(),
  input: z.string(),
  durationMs: z.number().nonnegative(),
});

const TaskCallEvent = z.object({
  event: z.literal("task-call"),
  at: Iso,
  sessionId: z.string(),
  phase: z.string(),
  agent: z.string(),
  durationMs: z.number().nonnegative(),
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
});

export const PLAN_STATS_CATEGORIES = [
  "rephrase",
  "wrong",
  "praise",
  "cascade",
  "impact",
  "quality",
] as const;

const PlanStatsByCategory = z.object({
  rephrase: z.number().int().nonnegative(),
  wrong: z.number().int().nonnegative(),
  praise: z.number().int().nonnegative(),
  cascade: z.number().int().nonnegative(),
  impact: z.number().int().nonnegative(),
  quality: z.number().int().nonnegative(),
});

const PlanStatsEvent = z.object({
  event: z.literal("plan-stats"),
  at: Iso,
  sessionId: z.string(),
  blocks: z.number().int().nonnegative(),
  byCategory: PlanStatsByCategory,
  ambiguous: z.number().int().nonnegative(),
  avgDiffLines: z.number().nonnegative(),
});

const ApplyEvent = z.object({
  event: z.literal("apply"),
  at: Iso,
  sessionId: z.string(),
  blocksApplied: z.number().int().nonnegative(),
  blocksFailed: z.number().int().nonnegative(),
  totalMs: z.number().nonnegative(),
  // True when apply_hunks succeeded; false when it returned an Err. Lets a
  // metrics consumer tell "apply produced 0 blocks" from "apply threw".
  ok: z.boolean(),
});

const ErrorEvent = z.object({
  event: z.literal("error"),
  at: Iso,
  sessionId: z.string(),
  stage: z.string(),
  message: z.string(),
});

// WS6: per-export count of how many annotations entered the bundle with each
// anchor kind. `source` means pre-resolution succeeded (or the anchor was
// already source-keyed at ingest); the plugin can jump straight to the file
// span. `pdfFallback` / `htmlFallback` mean the plan-fix skill has to fuzzy
// match the quote at apply time. Tracked per session to measure the success
// rate of the desktop's pre-resolution pass.
const AnchorResolutionEvent = z.object({
  event: z.literal("anchor-resolution"),
  at: Iso,
  sessionId: z.string(),
  source: z.number().int().nonnegative(),
  pdfFallback: z.number().int().nonnegative(),
  htmlFallback: z.number().int().nonnegative(),
});

export const MetricEvent = z.discriminatedUnion("event", [
  BundleStatsEvent,
  BundleValidatedEvent,
  PreflightRustEvent,
  PhaseEvent,
  PhaseTokensEvent,
  ToolCallEvent,
  TaskCallEvent,
  PlanStatsEvent,
  ApplyEvent,
  ErrorEvent,
  AnchorResolutionEvent,
]);

export type MetricEvent = z.infer<typeof MetricEvent>;

export type PlanStatsByCategoryShape = z.infer<typeof PlanStatsByCategory>;

// Append one event. Validates with Zod *before* sending to Rust so a malformed
// shape is caught at the source line rather than as a JSONL parse failure
// later. Boundary log on validation failure; never throws.
export async function appendMetric(
  projectId: string,
  sessionId: string,
  event: MetricEvent,
): Promise<void> {
  const parsed = MetricEvent.safeParse(event);
  if (!parsed.success) {
    console.warn("[metrics-append]", {
      sessionId,
      reason: "zod-validation-failed",
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
    return;
  }
  try {
    await invoke<void>("metrics_append", {
      projectId,
      sessionId,
      eventJson: JSON.stringify(parsed.data),
    });
  } catch (err) {
    console.warn("[metrics-append]", {
      sessionId,
      reason: "invoke-failed",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

// Truncate the JSON-stringified tool input to ~200 chars for the metrics
// `input` field. The metrics file should stay readable; full payloads belong
// in the Claude session log if a deeper inspection is needed.
export function summariseToolInput(input: unknown): string {
  let text: string;
  try {
    text = typeof input === "string" ? input : JSON.stringify(input);
  } catch {
    text = "<unserialisable>";
  }
  if (text.length <= 200) return text;
  return `${text.slice(0, 197)}...`;
}
