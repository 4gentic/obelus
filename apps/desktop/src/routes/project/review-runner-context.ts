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

export interface RunOptions {
  paperId: string;
  indications?: string;
  extraPromptBody?: string;
  // When omitted, the runner picks based on project.kind: writer→writer-fast,
  // reviewer→rigorous. UI affordances (Fast / Rigorous selector) override.
  mode?: ReviewRunnerMode;
}

// Inputs for a deep-review run on top of an already-ingested rigorous plan.
// The bundleId comes from the existing review session row, and the plan path
// is resolved from the workspace by filename match. Model/effort are picked
// from the persisted reviewer-thoroughness toggle inside the runner.
export interface DeepReviewOptions {
  reviewSessionId: string;
  paperId: string;
  planWorkspaceRelPath: string;
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
