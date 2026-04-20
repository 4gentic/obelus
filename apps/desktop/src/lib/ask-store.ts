import type { AskMessageRow, AskThreadsRepo } from "@obelus/repo";
import { create, type StoreApi, type UseBoundStore } from "zustand";

export type AskStatus =
  | { kind: "idle" }
  | { kind: "streaming"; assistantId: string; claudeSessionId: string }
  | { kind: "error"; message: string };

export interface AskState {
  threadId: string | null;
  messages: AskMessageRow[];
  status: AskStatus;

  load(threadId: string): Promise<void>;
  appendUser(body: string): Promise<AskMessageRow>;
  startAssistant(claudeSessionId: string): Promise<AskMessageRow>;
  appendChunk(line: string): void;
  finishAssistant(opts?: { cancelled?: boolean }): Promise<void>;
  failAssistant(message: string): Promise<void>;
  clear(): Promise<void>;
}

export type AskStore = UseBoundStore<StoreApi<AskState>>;

function withMessage(
  messages: ReadonlyArray<AskMessageRow>,
  id: string,
  patch: Partial<AskMessageRow>,
): AskMessageRow[] {
  return messages.map((m) => (m.id === id ? { ...m, ...patch } : m));
}

export function createAskStore(repo: AskThreadsRepo): AskStore {
  return create<AskState>()((set, get) => ({
    threadId: null,
    messages: [],
    status: { kind: "idle" },

    async load(threadId: string): Promise<void> {
      const messages = await repo.listMessages(threadId);
      set({ threadId, messages, status: { kind: "idle" } });
    },

    async appendUser(body: string): Promise<AskMessageRow> {
      const { threadId } = get();
      if (!threadId) throw new Error("ask thread not loaded");
      const row = await repo.appendMessage(threadId, { role: "user", body });
      set({ messages: [...get().messages, row] });
      return row;
    },

    async startAssistant(claudeSessionId: string): Promise<AskMessageRow> {
      const { threadId } = get();
      if (!threadId) throw new Error("ask thread not loaded");
      const row = await repo.appendMessage(threadId, { role: "assistant", body: "" });
      set({
        messages: [...get().messages, row],
        status: { kind: "streaming", assistantId: row.id, claudeSessionId },
      });
      return row;
    },

    appendChunk(line: string): void {
      const { status, messages } = get();
      if (status.kind !== "streaming") return;
      const current = messages.find((m) => m.id === status.assistantId);
      if (!current) return;
      const nextBody = current.body.length === 0 ? line : `${current.body}\n${line}`;
      set({ messages: withMessage(messages, status.assistantId, { body: nextBody }) });
    },

    async finishAssistant(opts?: { cancelled?: boolean }): Promise<void> {
      const { status, messages } = get();
      if (status.kind !== "streaming") return;
      const current = messages.find((m) => m.id === status.assistantId);
      if (!current) {
        set({ status: { kind: "idle" } });
        return;
      }
      const cancelled = opts?.cancelled === true;
      await repo.updateMessage(current.id, { body: current.body, cancelled });
      set({
        messages: withMessage(messages, current.id, { cancelled }),
        status: { kind: "idle" },
      });
    },

    async failAssistant(message: string): Promise<void> {
      const { status, messages } = get();
      if (status.kind === "streaming") {
        const current = messages.find((m) => m.id === status.assistantId);
        if (current) {
          await repo.updateMessage(current.id, { body: current.body, cancelled: true });
          set({ messages: withMessage(messages, current.id, { cancelled: true }) });
        }
      }
      set({ status: { kind: "error", message } });
    },

    async clear(): Promise<void> {
      const { threadId } = get();
      if (!threadId) return;
      await repo.clear(threadId);
      set({ messages: [], status: { kind: "idle" } });
    },
  }));
}
