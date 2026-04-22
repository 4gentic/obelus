import type { DiffHunkRow, DiffHunkState, DiffHunksRepo } from "@obelus/repo";
import { create, type StoreApi, type UseBoundStore } from "zustand";

export type ApplyStatus =
  | { kind: "idle" }
  | { kind: "applying" }
  | {
      kind: "applied";
      filesWritten: number;
      hunksApplied: number;
      draftOrdinal?: number;
    }
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
  markApplied(info: { filesWritten: number; hunksApplied: number; draftOrdinal?: number }): void;
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

export function createDiffStore(repo: DiffHunksRepo): DiffStore {
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
      });
    },
  }));
}
