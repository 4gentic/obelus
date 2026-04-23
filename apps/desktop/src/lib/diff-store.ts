import type {
  DiffHunkApplyFailure,
  DiffHunkRow,
  DiffHunkState,
  DiffHunksRepo,
  ReviewSessionsRepo,
} from "@obelus/repo";
import { create, type StoreApi, type UseBoundStore } from "zustand";

// A hunk that failed to apply in the most-recent apply attempt. Matches the
// Rust `HunkFailure` wire shape (see apps/desktop/src/ipc/commands.ts) so the
// same value can flow from IPC → store → UI without a translation step.
export interface FailedHunkInfo {
  file: string;
  index: number;
  reason: string;
}

export type ApplyStatus =
  | { kind: "idle" }
  | { kind: "applying" }
  | {
      kind: "applied";
      filesWritten: number;
      hunksApplied: number;
      draftOrdinal?: number;
    }
  | {
      // Some hunks applied cleanly, others could not match the current source.
      // The session stays "pending" from the UI's point of view: the applied
      // hunks are snapshotted as a draft, but the review only closes when the
      // user dismisses the failures or discards the remaining review.
      kind: "partial";
      filesWritten: number;
      hunksApplied: number;
      hunksFailed: FailedHunkInfo[];
      draftOrdinal?: number;
    }
  | { kind: "error"; message: string };

// Auto-compile that runs after a new draft lands or after a draft switch.
// Separate from applyStatus so a successful apply on a project we can't
// compile stays reported as "applied", with compile info on its own line.
export type CompileStatus =
  | { kind: "idle" }
  | { kind: "compiling" }
  | { kind: "compiled"; outputRelPath: string }
  | { kind: "hint"; message: string }
  | { kind: "error"; message: string };

export interface DiffState {
  sessionId: string | null;
  hunks: DiffHunkRow[];
  focusedIndex: number;
  editingId: string | null;
  editingText: string;
  noteId: string | null;
  noteText: string;
  counts: Record<DiffHunkState, number>;
  applyStatus: ApplyStatus;
  compileStatus: CompileStatus;

  load(sessionId: string): Promise<void>;
  clear(): void;
  focus(index: number): void;
  focusFirst(): void;
  focusLast(): void;
  next(): void;
  prev(): void;
  accept(id?: string): Promise<void>;
  reject(id?: string): Promise<void>;
  acceptFile(file: string): Promise<void>;
  startEdit(id: string): void;
  setEditingText(text: string): void;
  commitEdit(): Promise<void>;
  cancelEdit(): void;
  startNote(id: string): void;
  setNoteText(text: string): void;
  commitNote(): Promise<void>;
  cancelNote(): void;
  setApplyStatus(status: ApplyStatus): void;
  setCompileStatus(status: CompileStatus): void;
  markApplied(info: { filesWritten: number; hunksApplied: number; draftOrdinal?: number }): void;
  // Partial-apply: mark per-hunk failures, keep the session open, transition
  // the status banner to "partial" so the UI can show a reconciliation CTA.
  markPartialApplied(info: {
    filesWritten: number;
    hunksApplied: number;
    draftOrdinal?: number;
    failuresByHunkId: ReadonlyMap<string, DiffHunkApplyFailure>;
    failures: ReadonlyArray<FailedHunkInfo>;
  }): void;
  // Drop all per-hunk failure markers and close the review as if the apply
  // had been clean. Called when the user clicks "dismiss failures" — they
  // accept the partial landing and move on.
  dismissApplyFailures(): Promise<void>;
}

export type DiffStore = UseBoundStore<StoreApi<DiffState>>;

function emptyCounts(): Record<DiffHunkState, number> {
  return { pending: 0, accepted: 0, rejected: 0, modified: 0 };
}

function recount(hunks: ReadonlyArray<DiffHunkRow>): Record<DiffHunkState, number> {
  const counts = emptyCounts();
  for (const h of hunks) counts[h.state] += 1;
  return counts;
}

export function createDiffStore(
  repo: DiffHunksRepo,
  reviewSessions: ReviewSessionsRepo,
): DiffStore {
  return create<DiffState>()((set, get) => ({
    sessionId: null,
    hunks: [],
    focusedIndex: 0,
    editingId: null,
    editingText: "",
    noteId: null,
    noteText: "",
    counts: emptyCounts(),
    applyStatus: { kind: "idle" },
    compileStatus: { kind: "idle" },

    async load(sessionId: string): Promise<void> {
      const hunks = await repo.listForSession(sessionId);
      set({
        sessionId,
        hunks,
        focusedIndex: 0,
        editingId: null,
        editingText: "",
        noteId: null,
        noteText: "",
        counts: recount(hunks),
        applyStatus: { kind: "idle" },
        compileStatus: { kind: "idle" },
      });
    },

    clear(): void {
      set({
        sessionId: null,
        hunks: [],
        focusedIndex: 0,
        editingId: null,
        editingText: "",
        noteId: null,
        noteText: "",
        counts: emptyCounts(),
        applyStatus: { kind: "idle" },
        compileStatus: { kind: "idle" },
      });
    },

    focus(index: number): void {
      const { hunks } = get();
      if (hunks.length === 0) return;
      const clamped = Math.max(0, Math.min(index, hunks.length - 1));
      set({ focusedIndex: clamped });
    },

    focusFirst(): void {
      get().focus(0);
    },

    focusLast(): void {
      get().focus(get().hunks.length - 1);
    },

    next(): void {
      get().focus(get().focusedIndex + 1);
    },

    prev(): void {
      get().focus(get().focusedIndex - 1);
    },

    async accept(id?: string): Promise<void> {
      const state = get();
      const target = id ?? state.hunks[state.focusedIndex]?.id;
      if (!target) return;
      await repo.setState(target, "accepted");
      const hunks = state.hunks.map((h) =>
        h.id === target ? { ...h, state: "accepted" as const } : h,
      );
      set({ hunks, counts: recount(hunks) });
    },

    async reject(id?: string): Promise<void> {
      const state = get();
      const target = id ?? state.hunks[state.focusedIndex]?.id;
      if (!target) return;
      await repo.setState(target, "rejected");
      const hunks = state.hunks.map((h) =>
        h.id === target ? { ...h, state: "rejected" as const } : h,
      );
      set({ hunks, counts: recount(hunks) });
    },

    async acceptFile(file: string): Promise<void> {
      const { sessionId, hunks } = get();
      if (!sessionId) return;
      await repo.acceptAllInFile(sessionId, file);
      const next = hunks.map((h) =>
        h.file === file && (h.state === "pending" || h.state === "rejected")
          ? { ...h, state: "accepted" as const }
          : h,
      );
      set({ hunks: next, counts: recount(next) });
    },

    startEdit(id: string): void {
      const hunk = get().hunks.find((h) => h.id === id);
      if (!hunk) return;
      set({
        editingId: id,
        editingText: hunk.modifiedPatchText ?? hunk.patch,
      });
    },

    setEditingText(text: string): void {
      set({ editingText: text });
    },

    async commitEdit(): Promise<void> {
      const { editingId, editingText, hunks } = get();
      if (!editingId) return;
      await repo.setModifiedPatch(editingId, editingText);
      const next = hunks.map((h) =>
        h.id === editingId
          ? { ...h, modifiedPatchText: editingText, state: "modified" as const }
          : h,
      );
      set({
        hunks: next,
        counts: recount(next),
        editingId: null,
        editingText: "",
      });
    },

    cancelEdit(): void {
      set({ editingId: null, editingText: "" });
    },

    startNote(id: string): void {
      const hunk = get().hunks.find((h) => h.id === id);
      if (!hunk) return;
      set({ noteId: id, noteText: hunk.noteText });
    },

    setNoteText(text: string): void {
      set({ noteText: text });
    },

    async commitNote(): Promise<void> {
      const { noteId, noteText, hunks } = get();
      if (!noteId) return;
      await repo.setNote(noteId, noteText);
      const next = hunks.map((h) => (h.id === noteId ? { ...h, noteText } : h));
      set({ hunks: next, noteId: null, noteText: "" });
    },

    cancelNote(): void {
      set({ noteId: null, noteText: "" });
    },

    setApplyStatus(status: ApplyStatus): void {
      set({ applyStatus: status });
    },

    setCompileStatus(status: CompileStatus): void {
      set({ compileStatus: status });
    },

    markApplied({ filesWritten, hunksApplied, draftOrdinal }): void {
      set({
        sessionId: null,
        hunks: [],
        focusedIndex: 0,
        editingId: null,
        editingText: "",
        noteId: null,
        noteText: "",
        counts: emptyCounts(),
        applyStatus:
          draftOrdinal === undefined
            ? { kind: "applied", filesWritten, hunksApplied }
            : { kind: "applied", filesWritten, hunksApplied, draftOrdinal },
        compileStatus: { kind: "idle" },
      });
    },

    markPartialApplied({
      filesWritten,
      hunksApplied,
      draftOrdinal,
      failuresByHunkId,
      failures,
    }): void {
      const { hunks } = get();
      const next = hunks.map((h) => {
        const failure = failuresByHunkId.get(h.id);
        return failure ? { ...h, applyFailure: failure } : { ...h, applyFailure: null };
      });
      set({
        hunks: next,
        counts: recount(next),
        applyStatus:
          draftOrdinal === undefined
            ? { kind: "partial", filesWritten, hunksApplied, hunksFailed: [...failures] }
            : {
                kind: "partial",
                filesWritten,
                hunksApplied,
                hunksFailed: [...failures],
                draftOrdinal,
              },
        compileStatus: { kind: "idle" },
      });
    },

    async dismissApplyFailures(): Promise<void> {
      const { sessionId, applyStatus } = get();
      if (!sessionId) return;
      if (applyStatus.kind !== "partial") return;
      // Mark the session applied before clearing the per-hunk markers. Without
      // this, `findLatestVisibleReviewForPaper` (filter: status completed/failed
      // && applied_at IS NULL) resurrects the session on the next launch, the
      // partial banner is lost on reload, and the source lock re-engages over
      // bytes that already reflect the partial landing.
      await reviewSessions.markApplied(sessionId);
      await repo.clearApplyFailures(sessionId);
      set({
        sessionId: null,
        hunks: [],
        focusedIndex: 0,
        editingId: null,
        editingText: "",
        noteId: null,
        noteText: "",
        counts: emptyCounts(),
        applyStatus:
          applyStatus.draftOrdinal === undefined
            ? {
                kind: "applied",
                filesWritten: applyStatus.filesWritten,
                hunksApplied: applyStatus.hunksApplied,
              }
            : {
                kind: "applied",
                filesWritten: applyStatus.filesWritten,
                hunksApplied: applyStatus.hunksApplied,
                draftOrdinal: applyStatus.draftOrdinal,
              },
      });
    },
  }));
}
