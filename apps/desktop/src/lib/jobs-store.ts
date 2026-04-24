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

export interface PhaseEntry {
  phase: string;
  at: number;
}

const PHASE_HISTORY_CAP = 32;

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
  message?: string;
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
  updatePhase(claudeSessionId: string, phase: string): void;
  recordObelusWrotePath(claudeSessionId: string, path: string): void;
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
      ...(input.counts !== undefined ? { counts: input.counts } : {}),
      ...(input.reviewSessionId !== undefined ? { reviewSessionId: input.reviewSessionId } : {}),
      ...(input.paperId !== undefined ? { paperId: input.paperId } : {}),
      ...(input.paperTitle !== undefined ? { paperTitle: input.paperTitle } : {}),
      ...(input.compiler !== undefined ? { compiler: input.compiler } : {}),
      ...(input.mainRelPath !== undefined ? { mainRelPath: input.mainRelPath } : {}),
    };
    set((s) => ({ jobs: { ...s.jobs, [input.claudeSessionId]: record } }));
  },

  updatePhase(id, phase) {
    set((s) => {
      const existing = s.jobs[id];
      if (!existing || existing.phase === phase) return s;
      const history = [...existing.phaseHistory, { phase, at: Date.now() }];
      if (history.length > PHASE_HISTORY_CAP) history.splice(0, history.length - PHASE_HISTORY_CAP);
      return { jobs: { ...s.jobs, [id]: { ...existing, phase, phaseHistory: history } } };
    });
  },

  recordObelusWrotePath(id, path) {
    set((s) => {
      const existing = s.jobs[id];
      if (!existing || existing.obelusWrotePath === path) return s;
      return { jobs: { ...s.jobs, [id]: { ...existing, obelusWrotePath: path } } };
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
          [id]: { ...existing, status: "done", message, phase: "", endedAt: Date.now() },
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
          [id]: { ...existing, status: "error", message, phase: "", endedAt: Date.now() },
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
          [id]: {
            ...existing,
            status: "cancelled",
            message: "Cancelled.",
            phase: "",
            endedAt: Date.now(),
          },
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
