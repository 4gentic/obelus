import {
  extractAssistantText,
  extractDeltaText,
  extractModel,
  extractResultText,
  extractUsage,
  onClaudeExit,
  onClaudeStderr,
  onClaudeStdout,
  PlanFileSchema,
  parseStreamLine,
  type StreamUsage,
} from "@obelus/claude-sidecar";
import type { ReactNode } from "react";
import { type JSX, useEffect } from "react";
import {
  compileLatex,
  compileTypst,
  type LatexCompiler,
  planRenderMd,
  workspacePath,
  workspaceReadFile,
} from "../ipc/commands";
import { artifactLabel } from "../lib/artifact-label";
import { sourcesDiffSincePresnap, takeSnapshotForSession } from "../lib/bundle-sources";
import { extractPhaseMarker, phaseFromEvent, SEMANTIC_PHASE_PREFIX } from "../lib/claude-phase";
import { type PhaseKind, useJobsStore } from "../lib/jobs-store";
import {
  appendMetric,
  type MetricEvent,
  nowIso,
  PLAN_STATS_CATEGORIES,
  type PlanStatsByCategoryShape,
} from "../lib/metrics";
import { MetricsStream } from "../lib/metrics-stream";
import { getRepository } from "../lib/repo";
import { getActiveBuffersStore } from "../routes/project/active-buffers-store";
import { ingestPlanFile } from "../routes/project/ingest-plan";
import { ingestWriteupFile } from "../routes/project/ingest-writeup";

// Plugins emit `OBELUS_WROTE: <relative-path>` once at the end of a successful
// run so the desktop can locate the file even when the directory scan would
// pick the wrong name. Match the marker tolerantly: leading whitespace is OK,
// the path runs to end-of-line.
const OBELUS_WROTE_RE = /OBELUS_WROTE:\s*(\S.*?)\s*$/m;

// `claude_session.rs::now_iso` emits "<unix-ms>ms" — strip the suffix and
// parse. Returns null on any malformed input so callers can fall back to
// `Date.now()` and the watchdog still ticks.
function parseTsMs(ts: string): number | null {
  if (!ts.endsWith("ms")) return null;
  const n = Number(ts.slice(0, -2));
  return Number.isFinite(n) ? n : null;
}

// Per-session state the stdout listener feeds and handleExit drains. Lives at
// module scope because handleExit is invoked outside the listener's effect
// closure; sessions are cleaned up as soon as they exit.
const semanticSessions = new Set<string>();
const sessionUsage = new Map<string, StreamUsage>();
const sessionModel = new Map<string, string>();
const sessionStreamStart = new Map<string, number>();
const sessionFirstObelusPhaseAt = new Map<string, number>();
const sessionMetrics = new Map<string, MetricsStream>();

function clearSession(sessionId: string): void {
  semanticSessions.delete(sessionId);
  sessionUsage.delete(sessionId);
  sessionModel.delete(sessionId);
  sessionStreamStart.delete(sessionId);
  sessionFirstObelusPhaseAt.delete(sessionId);
  sessionMetrics.delete(sessionId);
}

function ensureMetricsStream(sessionId: string, startedAt: number): MetricsStream {
  let s = sessionMetrics.get(sessionId);
  if (!s) {
    s = new MetricsStream({
      sessionId,
      startedAt,
      startedAtIso: new Date(startedAt).toISOString(),
    });
    sessionMetrics.set(sessionId, s);
  }
  return s;
}

function flushMetrics(
  projectId: string,
  sessionId: string,
  events: ReadonlyArray<MetricEvent>,
): void {
  for (const ev of events) {
    void appendMetric(projectId, sessionId, ev);
  }
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
    let unlistenStderr: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;

    // The Claude CLI's stderr carries warnings, errors, and plugin-load
    // diagnostics. It has never had a subscriber — route it to the console so
    // failed skill runs are inspectable in devtools.
    void onClaudeStderr((ev) => {
      if (cancelled) return;
      console.debug("[claude-stderr]", { sessionId: ev.sessionId, line: ev.line });
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenStderr = fn;
    });

    void onClaudeStdout((ev) => {
      if (cancelled) return;

      // Tick the watchdog *before* the parse short-circuit: any line at all —
      // even a malformed one — is proof the socket is alive. Using the event's
      // own ts (set by the Rust emit at line read time) keeps activity
      // tracking honest across UI render delays.
      useJobsStore.getState().noteEvent(ev.sessionId, parseTsMs(ev.ts) ?? Date.now());

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
      // plan-fix skill. Once a marker fires for this session, tool-level
      // events stop driving the phase label (oscillating Read/Grep would
      // otherwise overwrite the semantic name and skew per-phase timing).
      // They are not discarded though: in semantic mode we route them to
      // `currentTool`, a transient sub-caption that surfaces what the model
      // is doing *inside* the current phase without polluting the history.
      const marker = extractPhaseMarker(parsed);
      let nextPhase: string | null = null;
      let nextKind: PhaseKind = "tool";
      if (marker !== null) {
        semanticSessions.add(ev.sessionId);
        nextPhase = `${SEMANTIC_PHASE_PREFIX}${marker}`;
        nextKind = "semantic";
        if (!sessionFirstObelusPhaseAt.has(ev.sessionId)) {
          sessionFirstObelusPhaseAt.set(ev.sessionId, Date.now());
        }
      } else if (semanticSessions.has(ev.sessionId)) {
        const narration = phaseFromEvent(parsed);
        if (narration !== null) {
          useJobsStore.getState().setCurrentTool(ev.sessionId, narration);
        }
      } else {
        nextPhase = phaseFromEvent(parsed);
        nextKind = "tool";
      }
      if (nextPhase !== null) {
        const store = useJobsStore.getState();
        const before = store.get(ev.sessionId);
        if (before && before.phase !== nextPhase) {
          store.updatePhase(ev.sessionId, nextPhase, nextKind);
          const hist = store.get(ev.sessionId)?.phaseHistory ?? [];
          const last = hist[hist.length - 1];
          const prev = hist.length >= 2 ? hist[hist.length - 2] : undefined;
          if (last && prev) {
            // `[obelus:phase]` is the skill's own self-reported lifecycle —
            // an authoritative phase commitment. `[tool]` is raw tool-use
            // narration: useful while a run is in flight, but it oscillates
            // (Read → Read → Grep → Read) and is not a phase change. Keep
            // the two log streams distinct so timing tools and humans can
            // tell which signals to trust.
            const tag = last.kind === "semantic" ? "[obelus:phase]" : "[tool]";
            console.info(tag, {
              sessionId: ev.sessionId,
              from: prev.phase,
              to: last.phase,
              elapsedMs: last.at - prev.at,
            });
          }
        } else if (!before) {
          store.updatePhase(ev.sessionId, nextPhase, nextKind);
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

      // WS3 metrics: feed the session's stream tracker. Project id comes from
      // the registered job record; events for sessions we don't know about
      // (race with `register`) are silently dropped — the next event will
      // catch up.
      const job = useJobsStore.getState().get(ev.sessionId);
      if (job) {
        const tracker = ensureMetricsStream(ev.sessionId, job.startedAt);
        const atMs = parseTsMs(ev.ts) ?? Date.now();
        tracker.ingest(parsed, atMs, new Date(atMs).toISOString());
        flushMetrics(job.projectId, ev.sessionId, tracker.drain());
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
      unlistenStderr?.();
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

  // WS3 metrics: close the active phase and (if a plan was written) compute
  // its stats. Done before we stomp on session state below.
  await finalizeMetrics(sessionId, job.projectId, job.obelusWrotePath);

  emitReviewTiming(sessionId, job.startedAt, job.phaseHistory, code, wasCancelled);

  console.info("[claude-exit]", {
    sessionId,
    kind: job.kind,
    code,
    wasCancelled,
    obelusWrotePath: job.obelusWrotePath ?? null,
    // `semanticPhases` are the plugin's self-reported lifecycle markers.
    // `toolHistory` is raw tool-use narration kept around for debugging
    // when the skill never emitted any markers (which is itself a signal
    // that something went wrong with the invocation).
    semanticPhases: job.phaseHistory.filter((p) => p.kind === "semantic").map((p) => p.phase),
    toolHistory: job.phaseHistory.filter((p) => p.kind === "tool").map((p) => p.phase),
  });

  // `review` and `compile-fix` both carry a review_session row whose status
  // gates the Diff-tab visibility. `writeup` jobs don't.
  const reviewSessionId =
    job.kind === "review" || job.kind === "compile-fix" ? job.reviewSessionId : undefined;

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

  const tIngestStart = performance.now();
  try {
    if (job.kind === "review") {
      // Before ingest: check whether Claude edited any bundle-referenced
      // source file directly. The plugin's apply-revision SKILL forbids
      // that; when it happens (observed on writer-mode MD papers), the
      // desktop has no plan to ingest but the working tree has been
      // mutated — users deserve a specific diagnostic, not the generic
      // "no plan matched this run's bundle" wall of text.
      if (reviewSessionId) {
        const snap = takeSnapshotForSession(reviewSessionId);
        if (snap && !job.obelusWrotePath) {
          const changed = await sourcesDiffSincePresnap(job.rootId, snap);
          if (changed.length > 0) {
            const list = changed.slice(0, 5).join(", ");
            const more = changed.length > 5 ? ` (+${changed.length - 5} more)` : "";
            const headline = `Claude edited paper source directly — the plugin's apply-revision skill forbids that. The edits are still in your working tree.`;
            const details = `Files changed while the review was running: ${list}${more}.\nRun \`git diff\` to inspect, \`git checkout -- <file>\` to revert, then try Start review again.`;
            const detail = `${headline}\n\n${details}`;
            console.warn("[tool-policy-violation]", {
              sessionId,
              reviewSessionId,
              changed,
            });
            store.markError(sessionId, detail);
            await markReviewStatus(reviewSessionId, "failed", detail);
            return;
          }
        }
      }
      // WS8: plan.json is the contract; the desktop projects the .md from it
      // here so the model never spends time reasoning about a second shape.
      // Best-effort — projection failure must not block ingest, the diff
      // review UI reads the .json regardless.
      if (job.obelusWrotePath?.endsWith(".json")) {
        try {
          const tProject = performance.now();
          const mdPath = await planRenderMd(job.projectId, job.obelusWrotePath);
          console.info("[plan-render]", {
            sessionId,
            jsonPath: job.obelusWrotePath,
            mdPath,
            ms: Math.round(performance.now() - tProject),
          });
        } catch (err) {
          console.warn("[plan-render]", {
            sessionId,
            jsonPath: job.obelusWrotePath,
            detail: err instanceof Error ? err.message : String(err),
          });
        }
      }
      const message = await ingestReview(job.projectId, job.reviewSessionId, job.obelusWrotePath);
      console.info("[write-perf]", {
        step: "ingest",
        kind: "review",
        ms: Math.round(performance.now() - tIngestStart),
      });
      store.markDone(sessionId, message);
    } else if (job.kind === "compile-fix") {
      // The skill edits source directly. Refresh any open buffers so the
      // editor picks up the new bytes on disk — before verify, so the user
      // still sees the edits even if the recompile fails (throws below).
      await refreshOpenBuffers();
      const message = await verifyCompileFix(
        job.rootId,
        job.reviewSessionId,
        job.compiler,
        job.mainRelPath,
      );
      store.markDone(sessionId, message);
    } else {
      const ingested = await ingestWriteup(
        sessionId,
        job.paperId,
        job.projectId,
        job.obelusWrotePath,
      );
      console.info("[write-perf]", {
        step: "ingest",
        kind: "writeup",
        ms: Math.round(performance.now() - tIngestStart),
      });
      const bytes = new TextEncoder().encode(ingested.body).byteLength;
      store.markDone(
        sessionId,
        `Write-up ready. ${bytes.toLocaleString()} bytes from ${artifactLabel(ingested.path)}.`,
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

// Closes the metrics stream for a session: emits the final `phase` /
// `phase-tokens` events for whatever phase was active at exit, and — if the
// plugin wrote a plan file — emits `plan-stats` after reading it. Best-effort:
// any failure is logged and swallowed; metrics must never fail an exit path.
async function finalizeMetrics(
  sessionId: string,
  projectId: string,
  obelusWrotePath: string | undefined,
): Promise<void> {
  const tracker = sessionMetrics.get(sessionId);
  if (tracker) {
    const atMs = Date.now();
    tracker.finalize(atMs, new Date(atMs).toISOString());
    flushMetrics(projectId, sessionId, tracker.drain());
  }
  if (obelusWrotePath) {
    await emitPlanStats(projectId, sessionId, obelusWrotePath);
  }
}

function isPlanStatsCategory(value: string): value is keyof PlanStatsByCategoryShape {
  return (PLAN_STATS_CATEGORIES as ReadonlyArray<string>).includes(value);
}

async function emitPlanStats(
  projectId: string,
  sessionId: string,
  hintPath: string,
): Promise<void> {
  if (!hintPath.endsWith(".json")) return;
  try {
    const workspaceAbs = await workspacePath(projectId, "");
    const normalised = workspaceAbs.endsWith("/") ? workspaceAbs : `${workspaceAbs}/`;
    if (!hintPath.startsWith(normalised)) {
      console.warn("[metrics-plan-stats]", {
        sessionId,
        reason: "outside-workspace",
        hintPath,
      });
      return;
    }
    const rel = hintPath.slice(normalised.length);
    const buffer = await workspaceReadFile(projectId, rel);
    const text = new TextDecoder().decode(new Uint8Array(buffer));
    const parsed = PlanFileSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      console.warn("[metrics-plan-stats]", {
        sessionId,
        reason: "schema-failed",
        issues: parsed.error.issues.length,
      });
      return;
    }
    const blocks = parsed.data.blocks;
    const byCategory: PlanStatsByCategoryShape = {
      rephrase: 0,
      wrong: 0,
      praise: 0,
      cascade: 0,
      impact: 0,
      quality: 0,
    };
    let ambiguous = 0;
    let totalDiffLines = 0;
    let nonEmptyDiffs = 0;
    for (const b of blocks) {
      const firstId = b.annotationIds[0] ?? "";
      // Synthesised blocks key by their id prefix (cascade-, impact-,
      // quality-); user marks key by their declared category. The user's
      // 6-key shape stays stable; categories outside the keys (e.g.
      // weak-argument) don't get a slot here — that's by spec.
      let bucket: keyof PlanStatsByCategoryShape | null = null;
      if (firstId.startsWith("cascade-")) bucket = "cascade";
      else if (firstId.startsWith("impact-")) bucket = "impact";
      else if (firstId.startsWith("quality-")) bucket = "quality";
      else if (isPlanStatsCategory(b.category)) bucket = b.category;
      if (bucket) byCategory[bucket] += 1;
      if (b.ambiguous) ambiguous += 1;
      if (b.patch !== "") {
        nonEmptyDiffs += 1;
        totalDiffLines += b.patch.split("\n").length;
      }
    }
    const avgDiffLines = nonEmptyDiffs === 0 ? 0 : totalDiffLines / nonEmptyDiffs;
    await appendMetric(projectId, sessionId, {
      event: "plan-stats",
      at: nowIso(),
      sessionId,
      blocks: blocks.length,
      byCategory,
      ambiguous,
      avgDiffLines,
    });
  } catch (err) {
    console.warn("[metrics-plan-stats]", {
      sessionId,
      reason: "read-failed",
      detail: err instanceof Error ? err.message : String(err),
    });
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
  history: ReadonlyArray<{ phase: string; kind: PhaseKind; at: number }>,
  code: number | null,
  wasCancelled: boolean,
): void {
  const finishedAt = Date.now();
  const phases: Array<{ phase: string; kind: PhaseKind; elapsedMs: number }> = [];
  for (let i = 0; i < history.length; i++) {
    const cur = history[i];
    if (!cur) continue;
    const nextEntry = history[i + 1];
    const endAt = nextEntry ? nextEntry.at : finishedAt;
    phases.push({ phase: cur.phase, kind: cur.kind, elapsedMs: endAt - cur.at });
  }
  const usage = sessionUsage.get(sessionId);
  const firstStdoutAt = sessionStreamStart.get(sessionId);
  const firstObelusPhaseAt = sessionFirstObelusPhaseAt.get(sessionId);
  console.info("[review-timing]", {
    sessionId,
    totalMs: finishedAt - startedAt,
    clickToFirstStdoutMs: firstStdoutAt !== undefined ? firstStdoutAt - startedAt : null,
    clickToFirstObelusPhaseMs:
      firstObelusPhaseAt !== undefined ? firstObelusPhaseAt - startedAt : null,
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
  projectId: string,
  reviewSessionId: string | undefined,
  hintPath: string | undefined,
): Promise<string> {
  if (!reviewSessionId) throw new Error("review job is missing reviewSessionId");
  const repo = await getRepository();
  const result = await ingestPlanFile({
    repo,
    projectId,
    sessionId: reviewSessionId,
    ...(hintPath !== undefined ? { hintPath } : {}),
  });
  await repo.reviewSessions.complete(reviewSessionId);

  // A completed session with zero hunks has nothing to offer the Diff tab —
  // leaving it 'completed' makes findLatestVisibleReviewForPaper resurface it
  // as a zombie "Plan loaded but no hunks were produced" card that the user
  // has to dismiss manually. Transition straight to 'discarded' so the Diff
  // tab stays clean. Annotations (marks) are persisted separately and are
  // unaffected by this status change. Additive ingests (deep-review on top
  // of an existing rigorous plan) never auto-discard — the underlying
  // rigorous plan already supplies hunks, even when the deep-review run
  // proposes zero new ones.
  const autoDiscarded = !result.additive && result.hunkCount === 0;
  if (autoDiscarded) {
    await repo.reviewSessions.setStatus(
      reviewSessionId,
      "discarded",
      result.blockCount === 0
        ? "Reviewer proposed no changes."
        : "Plan produced no hunks for this session.",
    );
  }

  console.info("[ingest-plan]", {
    sessionId: reviewSessionId,
    planPath: result.planPath,
    planBundleId: result.planBundleId,
    sessionBundleId: result.sessionBundleId,
    additive: result.additive,
    existingHunkCount: result.existingHunkCount,
    blockCount: result.blockCount,
    hunkCount: result.hunkCount,
    synthesisedKept: result.synthesisedKept,
    droppedForUnknownAnnotation: result.droppedForUnknownAnnotation,
    scannedPlans: result.scannedPlans,
    hasSources: result.hasSources,
    autoDiscarded,
  });

  if (result.droppedForUnknownAnnotation.length > 0 && result.hunkCount === 0) {
    throw new Error(
      `plan referenced ${result.droppedForUnknownAnnotation.length} unknown annotation(s) and produced no hunks for this session`,
    );
  }
  if (result.additive) {
    if (result.hunkCount === 0) {
      return "Deep review complete. Nothing additional to propose.";
    }
    return `Deep review ready. ${result.hunkCount} additional change${result.hunkCount === 1 ? "" : "s"} proposed.`;
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

// fix-compile is a direct-edit skill: Claude edits the source files in place
// and stops. The desktop verifies by re-running the compiler here. Success →
// "Fix applied …"; failure propagates as a thrown Error whose message carries
// the new compile stderr, so handleExit's catch marks the session as Error
// with that detail — the user sees what's still wrong and can try again.
async function verifyCompileFix(
  rootId: string,
  reviewSessionId: string | undefined,
  compiler: string | undefined,
  mainRelPath: string | undefined,
): Promise<string> {
  if (!reviewSessionId) throw new Error("compile-fix job is missing reviewSessionId");
  const repo = await getRepository();

  // `complete()` stamps `completed_at` and sets status='completed'. Defer it
  // to the success returns below: if the verify recompile throws, the outer
  // handleExit catch calls setStatus('failed', …) which leaves completed_at
  // NULL — the invariant migration 0002 relies on.
  if (!compiler || !mainRelPath) {
    console.info("[verify-compile-fix]", {
      sessionId: reviewSessionId,
      verified: false,
      reason: "missing-compiler-or-main",
    });
    await repo.reviewSessions.complete(reviewSessionId);
    return "Fix applied. Click Compile to verify.";
  }

  const fileLabel = mainRelPath.split("/").pop() ?? mainRelPath;
  try {
    if (compiler === "typst") {
      await compileTypst(rootId, mainRelPath);
    } else if (isLatexCompiler(compiler)) {
      await compileLatex(rootId, mainRelPath, compiler);
    } else {
      console.info("[verify-compile-fix]", {
        sessionId: reviewSessionId,
        verified: false,
        reason: `compiler-${compiler}-not-wired`,
      });
      await repo.reviewSessions.complete(reviewSessionId);
      return `Fix applied. Click Compile to verify (${compiler} auto-verify is not wired).`;
    }
  } catch (err) {
    const stderr = err instanceof Error ? err.message : String(err);
    console.info("[verify-compile-fix]", { sessionId: reviewSessionId, verified: false, stderr });
    throw new Error(`Fix attempt did not clear the compile error:\n${stderr}`);
  }
  console.info("[verify-compile-fix]", { sessionId: reviewSessionId, verified: true });
  await repo.reviewSessions.complete(reviewSessionId);
  return `Fix applied. ${fileLabel} now compiles cleanly.`;
}

function isLatexCompiler(c: string): c is LatexCompiler {
  return c === "latexmk" || c === "pdflatex" || c === "xelatex";
}

// Re-read every open source buffer from disk. Clean buffers get their text
// replaced and their externalVersion bumped (the editor remounts with fresh
// content); dirty buffers are left alone by refreshFromDisk, so an in-flight
// edit is never clobbered. Safe no-op when no project is mounted.
async function refreshOpenBuffers(): Promise<void> {
  const store = getActiveBuffersStore();
  if (!store) return;
  const paths = Array.from(store.getState().buffers.keys());
  if (paths.length === 0) return;
  try {
    await store.getState().refreshFromDisk(paths);
    console.info("[buffers-refresh]", { paths });
  } catch (err) {
    console.warn("[buffers-refresh]", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

async function ingestWriteup(
  sessionId: string,
  paperId: string | undefined,
  projectId: string,
  hintPath: string | undefined,
): Promise<{ path: string; body: string }> {
  if (!paperId) throw new Error("writeup job is missing paperId");
  const ingested = await ingestWriteupFile({
    projectId,
    paperId,
    ...(hintPath !== undefined ? { hintPath } : {}),
  });
  if (!ingested) {
    const hintNote = hintPath
      ? ` Marker pointed at \`${hintPath}\` but the file was not readable.`
      : " No `OBELUS_WROTE:` marker was emitted by the plugin.";
    throw new Error(
      `Claude finished but no writeup was found for paper ${paperId}.${hintNote} Expected \`writeup-${paperId}-<timestamp>.md\` in the project workspace.`,
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
