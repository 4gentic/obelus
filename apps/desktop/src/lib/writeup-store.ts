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
  dirty: boolean;
  status: WriteUpStatus;

  load(projectId: string, paperId: string): Promise<void>;
  startDrafting(claudeSessionId: string): void;
  appendChunk(line: string): void;
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
    dirty: false,
    status: { kind: "idle" },

    async load(projectId: string, paperId: string): Promise<void> {
      const existing = await repo.getForPaper(projectId, paperId);
      set({
        projectId,
        paperId,
        row: existing ?? null,
        body: existing?.bodyMd ?? "",
        dirty: false,
        status: { kind: "idle" },
      });
    },

    startDrafting(claudeSessionId: string): void {
      set({
        body: "",
        dirty: true,
        status: { kind: "streaming", claudeSessionId },
      });
    },

    appendChunk(line: string): void {
      const { status, body } = get();
      if (status.kind !== "streaming") return;
      const nextBody = body.length === 0 ? line : `${body}\n${line}`;
      set({ body: nextBody });
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
