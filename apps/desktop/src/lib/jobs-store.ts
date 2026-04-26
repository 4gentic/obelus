import { create, type StoreApi, type UseBoundStore } from "zustand";

// The global registry of Claude-backed jobs that survive route navigation.
// Scoped to the app process: if the app quits, the child `claude` process
// dies too, so there is no state to persist beyond the session.

export type JobKind = "review" | "writeup" | "compile-fix";

export type JobStatus = "running" | "ingesting" | "done" | "error" | "cancelled";

export interface JobCounts {
  marks: number;
  files: number;
}

// `semantic` entries come from the plugin's explicit `[obelus:phase] X`
// markers (the skill's own self-reported lifecycle). `tool` entries are
// derived from raw `tool_use` events in the model stream — useful narration
// while a run is in flight, but they are not phases the skill committed to,
// and they oscillate as the model jumps between Read / Grep / Bash calls.
// Logs and UI surfaces should distinguish the two so users don't read
// tool-call noise as authoritative skill state.
export type PhaseKind = "semantic" | "tool";

export interface PhaseEntry {
  phase: string;
  kind: PhaseKind;
  at: number;
}

const PHASE_HISTORY_CAP = 32;

// A running job that hasn't produced a stdout line in this many ms is treated
// as stalled. Empirically the only thing that buys us this much silence is a
// dead TCP socket (laptop suspend, network drop, server-side hang) — Claude's
// stream-json fires partial-message deltas on a sub-second cadence during
// active generation, and even long-tool-call phases (large reads, big greps)
// emit tool_use / tool_result around them well within this window.
export const STALL_THRESHOLD_MS = 180_000;

export interface JobRecord {
  claudeSessionId: string;
  projectId: string;
  projectLabel: string;
  rootId: string;
  kind: JobKind;
  reviewSessionId?: string;
  paperId?: string;
  paperTitle?: string;
  startedAt: number;
  endedAt?: number;
  counts?: JobCounts;
  status: JobStatus;
  phase: string;
  phaseHistory: PhaseEntry[];
  // Latest tool-narration caption (e.g. "Reading paper.tex") seen *during* the
  // current semantic phase. Lives outside `phaseHistory` so commit 22e6aea's
  // rule — semantic phases are the authoritative log, tool noise is not — still
  // holds. Cleared on each new semantic phase and at terminal status.
  currentTool?: string;
  message?: string;
  // Wall-clock ms when the listener last saw a stdout line for this session.
  // The dock derives "stalled" from `Date.now() - lastEventAt > threshold`. A
  // job that never produces a single line will sit at `startedAt` and trip the
  // watchdog at threshold, which is the correct semantics — silence from the
  // CLI is the failure we're trying to surface.
  lastEventAt?: number;
  // Wall-clock ms when the user clicked "Keep waiting" on the stalled banner.
  // While set and within `STALL_THRESHOLD_MS` of now, the banner is suppressed;
  // a fresh stream event clears it so the next genuine stall re-prompts.
  stalledAckAt?: number;
  // Path the plugin printed in its `OBELUS_WROTE: <path>` marker line. Used
  // by ingest as a hint when the desktop's filesystem scan would otherwise
  // miss the file (e.g. a smaller model wrote to a non-canonical name).
  obelusWrotePath?: string;
  // compile-fix jobs only: the compiler + main file to re-run once the skill
  // finishes editing source. Mirrors the fields sent to the skill in the
  // compile-error bundle; retained on the record so the post-exit recompile
  // has everything it needs without another round-trip to the paper_build row.
  compiler?: string;
  mainRelPath?: string;
}

export interface RegisterInput {
  claudeSessionId: string;
  projectId: string;
  projectLabel: string;
  rootId: string;
  kind: JobKind;
  startedAt: number;
  counts?: JobCounts;
  reviewSessionId?: string;
  paperId?: string;
  paperTitle?: string;
  compiler?: string;
  mainRelPath?: string;
}

export interface JobsState {
  jobs: Record<string, JobRecord>;
  register(input: RegisterInput): void;
  updatePhase(claudeSessionId: string, phase: string, kind: PhaseKind): void;
  setCurrentTool(claudeSessionId: string, tool: string | null): void;
  recordObelusWrotePath(claudeSessionId: string, path: string): void;
  noteEvent(claudeSessionId: string, at: number): void;
  acknowledgeStall(claudeSessionId: string): void;
  markIngesting(claudeSessionId: string): void;
  markDone(claudeSessionId: string, message: string): void;
  markError(claudeSessionId: string, message: string): void;
  markCancelled(claudeSessionId: string): void;
  dismiss(claudeSessionId: string): void;
  get(claudeSessionId: string): JobRecord | undefined;
}

export type JobsStore = UseBoundStore<StoreApi<JobsState>>;

export const useJobsStore: JobsStore = create<JobsState>()((set, get) => ({
  jobs: {},

  register(input) {
    const record: JobRecord = {
      claudeSessionId: input.claudeSessionId,
      projectId: input.projectId,
      projectLabel: input.projectLabel,
      rootId: input.rootId,
      kind: input.kind,
      startedAt: input.startedAt,
      status: "running",
      phase: "",
      phaseHistory: [],
      // Seed the watchdog at startedAt: a job that never produces a single
      // stream line should trip "stalled" at threshold rather than sit
      // indefinitely (a CLI that fails to spawn at all is the most acute
      // version of "stuck and silent").
      lastEventAt: input.startedAt,
      ...(input.counts !== undefined ? { counts: input.counts } : {}),
      ...(input.reviewSessionId !== undefined ? { reviewSessionId: input.reviewSessionId } : {}),
      ...(input.paperId !== undefined ? { paperId: input.paperId } : {}),
      ...(input.paperTitle !== undefined ? { paperTitle: input.paperTitle } : {}),
      ...(input.compiler !== undefined ? { compiler: input.compiler } : {}),
      ...(input.mainRelPath !== undefined ? { mainRelPath: input.mainRelPath } : {}),
    };
    set((s) => ({ jobs: { ...s.jobs, [input.claudeSessionId]: record } }));
  },

  updatePhase(id, phase, kind) {
    set((s) => {
      const existing = s.jobs[id];
      if (!existing || existing.phase === phase) return s;
      const history = [...existing.phaseHistory, { phase, kind, at: Date.now() }];
      if (history.length > PHASE_HISTORY_CAP) history.splice(0, history.length - PHASE_HISTORY_CAP);
      const next: JobRecord = { ...existing, phase, phaseHistory: history };
      // The previous phase's last tool caption is stale once a new semantic
      // marker fires; the next tool event for this session will repopulate it.
      if (kind === "semantic") delete next.currentTool;
      return { jobs: { ...s.jobs, [id]: next } };
    });
  },

  setCurrentTool(id, tool) {
    set((s) => {
      const existing = s.jobs[id];
      if (!existing) return s;
      if (tool === null) {
        if (existing.currentTool === undefined) return s;
        const { currentTool: _drop, ...rest } = existing;
        return { jobs: { ...s.jobs, [id]: rest } };
      }
      if (existing.currentTool === tool) return s;
      return { jobs: { ...s.jobs, [id]: { ...existing, currentTool: tool } } };
    });
  },

  recordObelusWrotePath(id, path) {
    set((s) => {
      const existing = s.jobs[id];
      if (!existing || existing.obelusWrotePath === path) return s;
      return { jobs: { ...s.jobs, [id]: { ...existing, obelusWrotePath: path } } };
    });
  },

  noteEvent(id, at) {
    set((s) => {
      const existing = s.jobs[id];
      if (!existing) return s;
      // A fresh stream line proves the socket is alive; any prior "Keep waiting"
      // ack is now stale because the next stall would be a new one.
      // `exactOptionalPropertyTypes` forbids assigning `undefined` directly, so
      // strip the field by destructuring rather than setting it.
      const { stalledAckAt: _drop, ...rest } = existing;
      return { jobs: { ...s.jobs, [id]: { ...rest, lastEventAt: at } } };
    });
  },

  acknowledgeStall(id) {
    set((s) => {
      const existing = s.jobs[id];
      if (!existing) return s;
      return { jobs: { ...s.jobs, [id]: { ...existing, stalledAckAt: Date.now() } } };
    });
  },

  markIngesting(id) {
    set((s) => {
      const existing = s.jobs[id];
      if (!existing) return s;
      return { jobs: { ...s.jobs, [id]: { ...existing, status: "ingesting" } } };
    });
  },

  markDone(id, message) {
    set((s) => {
      const existing = s.jobs[id];
      if (!existing) return s;
      return {
        jobs: {
          ...s.jobs,
          [id]: terminalRecord(existing, "done", message),
        },
      };
    });
  },

  markError(id, message) {
    set((s) => {
      const existing = s.jobs[id];
      if (!existing) return s;
      return {
        jobs: {
          ...s.jobs,
          [id]: terminalRecord(existing, "error", message),
        },
      };
    });
  },

  markCancelled(id) {
    set((s) => {
      const existing = s.jobs[id];
      if (!existing) return s;
      return {
        jobs: {
          ...s.jobs,
          [id]: terminalRecord(existing, "cancelled", "Cancelled."),
        },
      };
    });
  },

  dismiss(id) {
    set((s) => {
      if (!s.jobs[id]) return s;
      const next = { ...s.jobs };
      delete next[id];
      return { jobs: next };
    });
  },

  get(id) {
    return get().jobs[id];
  },
}));

// `currentTool` is a transient in-flight caption; it must not survive into
// done/error/cancelled records. `exactOptionalPropertyTypes` forbids the
// `currentTool: undefined` assignment shortcut, so build the next record
// without the field. `lastEventAt` and `stalledAckAt` only drive the
// running-job watchdog and have no meaning on a terminal record; drop them.
function terminalRecord(
  existing: JobRecord,
  status: Extract<JobStatus, "done" | "error" | "cancelled">,
  message: string,
): JobRecord {
  const {
    currentTool: _drop,
    lastEventAt: _dropLastEvent,
    stalledAckAt: _dropStalledAck,
    ...rest
  } = existing;
  return { ...rest, status, message, phase: "", endedAt: Date.now() };
}

export function activeForProject(
  jobs: Record<string, JobRecord>,
  projectId: string,
  kind?: JobKind,
): JobRecord | undefined {
  for (const job of Object.values(jobs)) {
    if (job.projectId !== projectId) continue;
    if (kind !== undefined && job.kind !== kind) continue;
    if (job.status === "running" || job.status === "ingesting") return job;
  }
  return undefined;
}

export function latestForProject(
  jobs: Record<string, JobRecord>,
  projectId: string,
  kind?: JobKind,
): JobRecord | undefined {
  let best: JobRecord | undefined;
  for (const job of Object.values(jobs)) {
    if (job.projectId !== projectId) continue;
    if (kind !== undefined && job.kind !== kind) continue;
    if (!best || job.startedAt > best.startedAt) best = job;
  }
  return best;
}
