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
      const message = await ingestReview(job.rootId, job.reviewSessionId);
      store.markDone(sessionId, message);
    } else {
      const ingested = await ingestWriteup(sessionId, job.rootId, job.paperId, job.projectId);
      const bytes = new TextEncoder().encode(ingested.body).byteLength;
      const fileName = ingested.path.replace(/^\.obelus\//, "");
      store.markDone(
        sessionId,
        `Write-up ready. ${bytes.toLocaleString()} bytes from ${fileName}.`,
      );
    }
  } catch (err) {
    console.warn("[ingest]", { sessionId, kind: job.kind, err });
    store.markError(sessionId, err instanceof Error ? err.message : "Could not ingest output.");
  }
}

async function ingestReview(rootId: string, reviewSessionId: string | undefined): Promise<string> {
  if (!reviewSessionId) throw new Error("review job is missing reviewSessionId");
  const repo = await getRepository();
  const result = await ingestPlanFile({ repo, rootId, sessionId: reviewSessionId });
  await repo.reviewSessions.complete(reviewSessionId);

  console.info("[ingest-plan]", {
    sessionId: reviewSessionId,
    planPath: result.planPath,
    planBundleId: result.planBundleId,
    sessionBundleId: result.sessionBundleId,
    blockCount: result.blockCount,
    hunkCount: result.hunkCount,
    droppedForUnknownAnnotation: result.droppedForUnknownAnnotation,
    scannedPlans: result.scannedPlans,
  });

  if (result.droppedForUnknownAnnotation.length > 0 && result.hunkCount === 0) {
    throw new Error(
      `plan referenced ${result.droppedForUnknownAnnotation.length} unknown annotation(s) and produced no hunks for this session`,
    );
  }
  if (result.blockCount === 0) {
    return "Plan ready. Reviewer proposed no changes.";
  }
  if (result.droppedForUnknownAnnotation.length > 0) {
    return `Plan ready. ${result.hunkCount} change${result.hunkCount === 1 ? "" : "s"} (dropped ${result.droppedForUnknownAnnotation.length} stale block${result.droppedForUnknownAnnotation.length === 1 ? "" : "s"}).`;
  }
  return `Plan ready. ${result.hunkCount} change${result.hunkCount === 1 ? "" : "s"} proposed.`;
}

async function ingestWriteup(
  sessionId: string,
  rootId: string,
  paperId: string | undefined,
  projectId: string,
): Promise<{ path: string; body: string }> {
  if (!paperId) throw new Error("writeup job is missing paperId");
  const ingested = await ingestWriteupFile({ rootId, paperId });
  if (!ingested) {
    throw new Error("Claude finished but no .obelus/writeup-*.md file was written.");
  }
  const repo = await getRepository();
  await repo.writeUps.upsert({ projectId, paperId, bodyMd: ingested.body });

  console.info("[ingest-writeup]", {
    sessionId,
    paperId,
    projectId,
    path: ingested.path,
    byteLength: new TextEncoder().encode(ingested.body).byteLength,
  });

  return ingested;
}
