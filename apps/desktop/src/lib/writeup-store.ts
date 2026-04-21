import type { WriteUpRow, WriteUpsRepo } from "@obelus/repo";
import { create, type StoreApi, type UseBoundStore } from "zustand";

export type WriteUpStatus =
  | { kind: "idle" }
  | { kind: "streaming"; claudeSessionId: string }
  | { kind: "error"; message: string };

export interface WriteUpState {
  projectId: string | null;
  paperId: string | null;
  row: WriteUpRow | null;
  body: string;
  transcript: string;
  dirty: boolean;
  status: WriteUpStatus;

  load(projectId: string, paperId: string): Promise<void>;
  startDrafting(claudeSessionId: string): void;
  appendTranscript(chunk: string): void;
  finishDrafting(opts?: { cancelled?: boolean }): Promise<void>;
  failDrafting(message: string): void;
  setBody(body: string): void;
  save(): Promise<WriteUpRow | null>;
}

export type WriteUpStore = UseBoundStore<StoreApi<WriteUpState>>;

export function createWriteUpStore(repo: WriteUpsRepo): WriteUpStore {
  return create<WriteUpState>()((set, get) => ({
    projectId: null,
    paperId: null,
    row: null,
    body: "",
    transcript: "",
    dirty: false,
    status: { kind: "idle" },

    async load(projectId: string, paperId: string): Promise<void> {
      const existing = await repo.getForPaper(projectId, paperId);
      set({
        projectId,
        paperId,
        row: existing ?? null,
        body: existing?.bodyMd ?? "",
        transcript: "",
        dirty: false,
        status: { kind: "idle" },
      });
    },

    startDrafting(claudeSessionId: string): void {
      set({
        transcript: "",
        status: { kind: "streaming", claudeSessionId },
      });
    },

    appendTranscript(chunk: string): void {
      const { status, transcript } = get();
      if (status.kind !== "streaming") return;
      set({ transcript: transcript + chunk });
    },

    async finishDrafting(opts?: { cancelled?: boolean }): Promise<void> {
      const { status } = get();
      if (status.kind !== "streaming") return;
      if (opts?.cancelled === true) {
        set({ status: { kind: "idle" } });
        return;
      }
      const { projectId, paperId, body } = get();
      if (!projectId || !paperId) {
        set({ status: { kind: "idle" } });
        return;
      }
      const row = await repo.upsert({ projectId, paperId, bodyMd: body });
      set({ row, dirty: false, status: { kind: "idle" } });
    },

    failDrafting(message: string): void {
      set({ status: { kind: "error", message } });
    },

    setBody(body: string): void {
      const { row } = get();
      const dirty = row ? body !== row.bodyMd : body.length > 0;
      set({ body, dirty });
    },

    async save(): Promise<WriteUpRow | null> {
      const { projectId, paperId, body } = get();
      if (!projectId || !paperId) return null;
      const row = await repo.upsert({ projectId, paperId, bodyMd: body });
      set({ row, dirty: false });
      return row;
    },
  }));
}
