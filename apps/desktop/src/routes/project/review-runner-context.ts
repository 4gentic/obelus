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

export interface RunOptions {
  extraPromptBody?: string;
}

export interface ReviewRunnerContextValue {
  status: RunStatus;
  start: (opts?: RunOptions) => Promise<void>;
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
