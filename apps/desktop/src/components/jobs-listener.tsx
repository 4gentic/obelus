import {
  extractAssistantText,
  extractDeltaText,
  extractModel,
  extractResultText,
  extractUsage,
  onClaudeExit,
  onClaudeStdout,
  parseStreamLine,
  type StreamUsage,
} from "@obelus/claude-sidecar";
import type { ReactNode } from "react";
import { type JSX, useEffect } from "react";
import { extractPhaseMarker, phaseFromEvent, SEMANTIC_PHASE_PREFIX } from "../lib/claude-phase";
import { useJobsStore } from "../lib/jobs-store";
import { getRepository } from "../lib/repo";
import { ingestPlanFile } from "../routes/project/ingest-plan";
import { ingestWriteupFile } from "../routes/project/ingest-writeup";

// Plugins emit `OBELUS_WROTE: <relative-path>` once at the end of a successful
// run so the desktop can locate the file even when the directory scan would
// pick the wrong name. Match the marker tolerantly: leading whitespace is OK,
// the path runs to end-of-line.
const OBELUS_WROTE_RE = /OBELUS_WROTE:\s*(\S.*?)\s*$/m;

// Per-session state the stdout listener feeds and handleExit drains. Lives at
// module scope because handleExit is invoked outside the listener's effect
// closure; sessions are cleaned up as soon as they exit.
const semanticSessions = new Set<string>();
const sessionUsage = new Map<string, StreamUsage>();
const sessionModel = new Map<string, string>();
const sessionStreamStart = new Map<string, number>();

function clearSession(sessionId: string): void {
  semanticSessions.delete(sessionId);
  sessionUsage.delete(sessionId);
  sessionModel.delete(sessionId);
  sessionStreamStart.delete(sessionId);
}

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

      if (!sessionStreamStart.has(ev.sessionId)) {
        sessionStreamStart.set(ev.sessionId, Date.now());
      }

      const model = extractModel(parsed);
      if (model) sessionModel.set(ev.sessionId, model);
      const usage = extractUsage(parsed);
      if (usage) sessionUsage.set(ev.sessionId, usage);

      // Prefer semantic `[obelus:phase] X` markers emitted by the plugin's
      // plan-fix skill. Once a marker fires for this session, suppress
      // tool-level phase updates — otherwise a Read/Grep between markers
      // would overwrite the semantic label and skew the per-phase stopwatch.
      const marker = extractPhaseMarker(parsed);
      let nextPhase: string | null = null;
      if (marker !== null) {
        semanticSessions.add(ev.sessionId);
        nextPhase = `${SEMANTIC_PHASE_PREFIX}${marker}`;
      } else if (!semanticSessions.has(ev.sessionId)) {
        nextPhase = phaseFromEvent(parsed);
      }
      if (nextPhase !== null) {
        const store = useJobsStore.getState();
        const before = store.get(ev.sessionId);
        if (before && before.phase !== nextPhase) {
          store.updatePhase(ev.sessionId, nextPhase);
          const hist = store.get(ev.sessionId)?.phaseHistory ?? [];
          const last = hist[hist.length - 1];
          const prev = hist.length >= 2 ? hist[hist.length - 2] : undefined;
          if (last && prev) {
            console.info("[phase]", {
              sessionId: ev.sessionId,
              from: prev.phase,
              to: last.phase,
              elapsedMs: last.at - prev.at,
            });
          }
        } else if (!before) {
          store.updatePhase(ev.sessionId, nextPhase);
        }
      }

      const text =
        extractDeltaText(parsed) || extractAssistantText(parsed) || extractResultText(parsed) || "";
      if (text) {
        const match = text.match(OBELUS_WROTE_RE);
        if (match?.[1]) {
          useJobsStore.getState().recordObelusWrotePath(ev.sessionId, match[1]);
        }
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
  if (!job) {
    clearSession(sessionId);
    return;
  }

  emitReviewTiming(sessionId, job.startedAt, job.phaseHistory, code, wasCancelled);

  const reviewSessionId = job.kind === "review" ? job.reviewSessionId : undefined;

  if (wasCancelled) {
    store.markCancelled(sessionId);
    if (reviewSessionId) {
      await markReviewStatus(reviewSessionId, "discarded", "Cancelled by user.");
    }
    clearSession(sessionId);
    return;
  }
  if (code !== 0) {
    const msg = `Claude exited with code ${code ?? "?"}.`;
    store.markError(sessionId, msg);
    if (reviewSessionId) {
      await markReviewStatus(reviewSessionId, "failed", msg);
    }
    clearSession(sessionId);
    return;
  }

  store.markIngesting(sessionId);
  if (reviewSessionId) {
    await markReviewStatus(reviewSessionId, "ingesting", null);
  }

  try {
    if (job.kind === "review") {
      const message = await ingestReview(job.rootId, job.reviewSessionId, job.obelusWrotePath);
      store.markDone(sessionId, message);
    } else {
      const ingested = await ingestWriteup(
        sessionId,
        job.rootId,
        job.paperId,
        job.projectId,
        job.obelusWrotePath,
      );
      const bytes = new TextEncoder().encode(ingested.body).byteLength;
      const fileName = ingested.path.replace(/^\.obelus\//, "");
      store.markDone(
        sessionId,
        `Write-up ready. ${bytes.toLocaleString()} bytes from ${fileName}.`,
      );
    }
  } catch (err) {
    const detail =
      err instanceof Error ? err.message : typeof err === "string" ? err : JSON.stringify(err);
    console.warn("[ingest]", { sessionId, kind: job.kind, detail });
    store.markError(sessionId, detail);
    if (reviewSessionId) {
      await markReviewStatus(reviewSessionId, "failed", detail);
    }
  } finally {
    clearSession(sessionId);
  }
}

async function markReviewStatus(
  reviewSessionId: string,
  status: "ingesting" | "completed" | "failed" | "discarded",
  lastError: string | null,
): Promise<void> {
  try {
    const repo = await getRepository();
    await repo.reviewSessions.setStatus(reviewSessionId, status, lastError);
    console.info("[review-session]", { sessionId: reviewSessionId, status, lastError });
  } catch (err) {
    console.warn("[review-session]", {
      sessionId: reviewSessionId,
      status,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

// Structured record per session. Grep for `[review-timing]` in the devtools
// console (and in the Rust `[claude-session]` stderr line) to see what each
// phase cost and which model ran the orchestrator.
function emitReviewTiming(
  sessionId: string,
  startedAt: number,
  history: ReadonlyArray<{ phase: string; at: number }>,
  code: number | null,
  wasCancelled: boolean,
): void {
  const finishedAt = Date.now();
  const phases: Array<{ phase: string; elapsedMs: number }> = [];
  for (let i = 0; i < history.length; i++) {
    const cur = history[i];
    if (!cur) continue;
    const nextEntry = history[i + 1];
    const endAt = nextEntry ? nextEntry.at : finishedAt;
    phases.push({ phase: cur.phase, elapsedMs: endAt - cur.at });
  }
  const usage = sessionUsage.get(sessionId);
  console.info("[review-timing]", {
    sessionId,
    totalMs: finishedAt - startedAt,
    exitCode: code,
    cancelled: wasCancelled,
    model: sessionModel.get(sessionId) ?? null,
    inputTokens: usage?.inputTokens ?? null,
    cacheReadInputTokens: usage?.cacheReadInputTokens ?? null,
    cacheCreationInputTokens: usage?.cacheCreationInputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    phases,
  });
}

async function ingestReview(
  rootId: string,
  reviewSessionId: string | undefined,
  hintPath: string | undefined,
): Promise<string> {
  if (!reviewSessionId) throw new Error("review job is missing reviewSessionId");
  const repo = await getRepository();
  const result = await ingestPlanFile({
    repo,
    rootId,
    sessionId: reviewSessionId,
    ...(hintPath !== undefined ? { hintPath } : {}),
  });
  await repo.reviewSessions.complete(reviewSessionId);

  console.info("[ingest-plan]", {
    sessionId: reviewSessionId,
    planPath: result.planPath,
    planBundleId: result.planBundleId,
    sessionBundleId: result.sessionBundleId,
    blockCount: result.blockCount,
    hunkCount: result.hunkCount,
    synthesisedKept: result.synthesisedKept,
    droppedForUnknownAnnotation: result.droppedForUnknownAnnotation,
    scannedPlans: result.scannedPlans,
    hasSources: result.hasSources,
  });

  if (result.droppedForUnknownAnnotation.length > 0 && result.hunkCount === 0) {
    throw new Error(
      `plan referenced ${result.droppedForUnknownAnnotation.length} unknown annotation(s) and produced no hunks for this session`,
    );
  }
  if (!result.hasSources) {
    if (result.hunkCount === 0) {
      return "Review complete. No annotations to record.";
    }
    return `Review complete. ${result.hunkCount} note${result.hunkCount === 1 ? "" : "s"} recorded (no source files to patch).`;
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
  hintPath: string | undefined,
): Promise<{ path: string; body: string }> {
  if (!paperId) throw new Error("writeup job is missing paperId");
  const ingested = await ingestWriteupFile({
    rootId,
    paperId,
    ...(hintPath !== undefined ? { hintPath } : {}),
  });
  if (!ingested) {
    const hintNote = hintPath
      ? ` Marker pointed at \`${hintPath}\` but the file was not readable.`
      : " No `OBELUS_WROTE:` marker was emitted by the plugin.";
    throw new Error(
      `Claude finished but no writeup was found for paper ${paperId}.${hintNote} Expected \`.obelus/writeup-${paperId}-<timestamp>.md\`.`,
    );
  }
  const repo = await getRepository();
  await repo.writeUps.upsert({ projectId, paperId, bodyMd: ingested.body });

  console.info("[ingest-writeup]", {
    sessionId,
    paperId,
    projectId,
    path: ingested.path,
    byteLength: new TextEncoder().encode(ingested.body).byteLength,
    hintPath: hintPath ?? null,
  });

  return ingested;
}
