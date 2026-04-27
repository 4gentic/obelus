import type { ClaudeSpawnMode } from "@obelus/claude-sidecar";
import { createContext, useContext } from "react";
import type { ReviewProgressStore } from "./review-progress-store";

export interface RunCounts {
  marks: number;
  files: number;
  startedAt: number;
}

export type RunStatus =
  | { kind: "idle" }
  | { kind: "working"; step: string; counts: RunCounts }
  | {
      kind: "running";
      sessionId: string;
      claudeSessionId: string;
      counts: RunCounts;
    }
  | { kind: "ingesting"; counts: RunCounts }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

export type ReviewRunnerMode = ClaudeSpawnMode;

export type ReviewRunnerModelChoice = "sonnet" | "opus" | "haiku";
export type ReviewRunnerEffortChoice = "low" | "medium" | "high";

export const REVIEW_RUNNER_MODEL_CHOICES: ReadonlyArray<ReviewRunnerModelChoice> = [
  "sonnet",
  "opus",
  "haiku",
];
export const REVIEW_RUNNER_EFFORT_CHOICES: ReadonlyArray<ReviewRunnerEffortChoice> = [
  "low",
  "medium",
  "high",
];

export interface RunOptions {
  paperId: string;
  indications?: string;
  extraPromptBody?: string;
  // When omitted, the runner picks based on project.kind: writer→writer-fast,
  // reviewer→rigorous. UI affordances (Fast / Rigorous selector) override.
  mode?: ReviewRunnerMode;
  // Per-spawn override of the dispatch model + effort. When omitted, the
  // runner falls back to the cross-session ClaudeChip overrides
  // (`loadClaudeOverrides`); when those are also null, Rust applies the
  // sonnet/low default for dispatch skills.
  model?: ReviewRunnerModelChoice;
  effort?: ReviewRunnerEffortChoice;
}

// Inputs for a deep-review run on top of an already-ingested rigorous plan.
// Same dispatch picker as a regular review; the bundleId comes from the
// existing review session row, and the plan path is resolved from the
// workspace by filename match.
export interface DeepReviewOptions {
  reviewSessionId: string;
  paperId: string;
  planWorkspaceRelPath: string;
  model?: ReviewRunnerModelChoice;
  effort?: ReviewRunnerEffortChoice;
}

export interface ReviewRunnerContextValue {
  status: RunStatus;
  start: (opts?: RunOptions) => Promise<void>;
  startDeepReview: (opts: DeepReviewOptions) => Promise<void>;
  cancel: () => Promise<void>;
  progressStore: ReviewProgressStore;
}

export const ReviewRunnerContext = createContext<ReviewRunnerContextValue | null>(null);

export function useReviewRunner(): ReviewRunnerContextValue {
  const ctx = useContext(ReviewRunnerContext);
  if (!ctx) throw new Error("useReviewRunner requires ReviewRunnerProvider");
  return ctx;
}

export function useReviewProgress(): ReviewProgressStore {
  return useReviewRunner().progressStore;
}
