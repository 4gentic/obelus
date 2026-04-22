import { onClaudeExit, onClaudeStdout, parseStreamLine } from "@obelus/claude-sidecar";
import type { ReactNode } from "react";
import { type JSX, useEffect } from "react";
import { phaseFromEvent } from "../lib/claude-phase";
import { useJobsStore } from "../lib/jobs-store";
import { getRepository } from "../lib/repo";
import { ingestPlanFile } from "../routes/project/ingest-plan";
import { ingestWriteupFile } from "../routes/project/ingest-writeup";

// Owns the single, app-lifetime subscription to the Claude stdout/exit event
// stream. Routes events to the matching job record in the global jobs store.
// The per-route ReviewRunner / WriteUp providers used to each register their
// own listener; that design lost the stream when the user navigated away.
export default function JobsListener({ children }: { children: ReactNode }): JSX.Element {
  useEffect(() => {
    // `onClaude*` are async: if the effect re-runs (HMR, StrictMode double
    // invocation) before `.then` resolves, cleanup sees `unlisten` still null
    // and the first listener stays alive — producing a doubled stream. The
    // `cancelled` flag + in-callback guard keeps a single live sink regardless
    // of when the registration promises resolve.
    let cancelled = false;
    let unlistenStdout: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;

    void onClaudeStdout((ev) => {
      if (cancelled) return;
      const parsed = parseStreamLine(ev.line);
      if (!parsed) return;
      const phase = phaseFromEvent(parsed);
      if (phase !== null) {
        useJobsStore.getState().updatePhase(ev.sessionId, phase);
      }
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenStdout = fn;
    });

    void onClaudeExit((ev) => {
      if (cancelled) return;
      void handleExit(ev.sessionId, ev.code, ev.cancelled);
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenExit = fn;
    });

    return () => {
      cancelled = true;
      unlistenStdout?.();
      unlistenExit?.();
    };
  }, []);

  return <>{children}</>;
}

async function handleExit(
  sessionId: string,
  code: number | null,
  wasCancelled: boolean,
): Promise<void> {
  const store = useJobsStore.getState();
  const job = store.get(sessionId);
  if (!job) return;

  if (wasCancelled) {
    store.markCancelled(sessionId);
    return;
  }
  if (code !== 0) {
    store.markError(sessionId, `Claude exited with code ${code ?? "?"}.`);
    return;
  }

  store.markIngesting(sessionId);
  try {
    if (job.kind === "review") {
      await ingestReview(job.rootId, job.reviewSessionId);
      store.markDone(sessionId, "Plan ready.");
    } else {
      await ingestWriteup(job.rootId, job.paperId, job.projectId);
      store.markDone(sessionId, "Write-up ready.");
    }
  } catch (err) {
    store.markError(sessionId, err instanceof Error ? err.message : "Could not ingest output.");
  }
}

async function ingestReview(rootId: string, reviewSessionId: string | undefined): Promise<void> {
  if (!reviewSessionId) throw new Error("review job is missing reviewSessionId");
  const repo = await getRepository();
  const result = await ingestPlanFile({ repo, rootId, sessionId: reviewSessionId });
  await repo.reviewSessions.complete(reviewSessionId);
  if (result.hunkCount === 0) {
    // Keep going — the job is technically done, just with an empty plan.
  }
}

async function ingestWriteup(
  rootId: string,
  paperId: string | undefined,
  projectId: string,
): Promise<void> {
  if (!paperId) throw new Error("writeup job is missing paperId");
  const ingested = await ingestWriteupFile({ rootId, paperId });
  if (!ingested) {
    throw new Error("Claude finished but no .obelus/writeup-*.md file was written.");
  }
  const repo = await getRepository();
  await repo.writeUps.upsert({ projectId, paperId, bodyMd: ingested.body });
}
