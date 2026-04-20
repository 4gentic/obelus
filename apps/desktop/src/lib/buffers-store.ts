import { create, type StoreApi, type UseBoundStore } from "zustand";
import { fsReadFile, fsWriteBytes } from "../ipc/commands";

export interface BufferEntry {
  diskText: string;
  text: string;
  dirty: boolean;
  savedAt: string | null;
  // Incremented only when the buffer is replaced from disk by something other
  // than the user's own typing (apply-hunks, future file watcher). The editor
  // mount watches this to force a remount with the new content.
  externalVersion: number;
}

export interface BuffersState {
  rootId: string;
  buffers: Map<string, BufferEntry>;
  currentPath: string | null;
  pendingSwitch: string | null;

  setCurrentPath(path: string | null): void;
  hydrate(path: string, text: string): void;
  setText(path: string, text: string): void;
  save(path: string): Promise<void>;
  discard(path: string): void;
  anyDirty(): boolean;
  dirtyPaths(): string[];
  isDirty(path: string): boolean;
  requestSwitch(path: string): boolean;
  clearPendingSwitch(): void;
  refreshFromDisk(paths: ReadonlyArray<string>): Promise<void>;
}

export type BuffersStore = UseBoundStore<StoreApi<BuffersState>>;

export function createBuffersStore(rootId: string): BuffersStore {
  return create<BuffersState>()((set, get) => ({
    rootId,
    buffers: new Map(),
    currentPath: null,
    pendingSwitch: null,

    setCurrentPath(path: string | null): void {
      set({ currentPath: path, pendingSwitch: null });
    },

    hydrate(path: string, text: string): void {
      const existing = get().buffers.get(path);
      if (existing) return;
      const next = new Map(get().buffers);
      next.set(path, {
        diskText: text,
        text,
        dirty: false,
        savedAt: null,
        externalVersion: 0,
      });
      set({ buffers: next });
    },

    setText(path: string, text: string): void {
      const current = get().buffers.get(path);
      if (!current) return;
      const next = new Map(get().buffers);
      next.set(path, {
        ...current,
        text,
        dirty: text !== current.diskText,
      });
      set({ buffers: next });
    },

    async save(path: string): Promise<void> {
      const current = get().buffers.get(path);
      if (!current) return;
      const bytes = new TextEncoder().encode(current.text);
      await fsWriteBytes(get().rootId, path, bytes);
      const next = new Map(get().buffers);
      next.set(path, {
        ...current,
        diskText: current.text,
        dirty: false,
        savedAt: new Date().toISOString(),
      });
      set({ buffers: next });
    },

    discard(path: string): void {
      const current = get().buffers.get(path);
      if (!current) return;
      const next = new Map(get().buffers);
      next.set(path, {
        ...current,
        text: current.diskText,
        dirty: false,
      });
      set({ buffers: next });
    },

    anyDirty(): boolean {
      for (const b of get().buffers.values()) if (b.dirty) return true;
      return false;
    },

    dirtyPaths(): string[] {
      const out: string[] = [];
      for (const [path, b] of get().buffers.entries()) if (b.dirty) out.push(path);
      return out;
    },

    isDirty(path: string): boolean {
      return get().buffers.get(path)?.dirty === true;
    },

    requestSwitch(path: string): boolean {
      const { currentPath, buffers } = get();
      if (currentPath === null || currentPath === path) return true;
      const currentBuf = buffers.get(currentPath);
      if (!currentBuf?.dirty) return true;
      set({ pendingSwitch: path });
      return false;
    },

    clearPendingSwitch(): void {
      set({ pendingSwitch: null });
    },

    // Re-read `paths` from disk. For any that already have a clean open
    // buffer, replace diskText + text and bump externalVersion so the editor
    // remounts with fresh content. Dirty buffers are left alone — callers are
    // expected to have blocked on dirty already (apply-guard does).
    async refreshFromDisk(paths: ReadonlyArray<string>): Promise<void> {
      const rootId = get().rootId;
      const current = get().buffers;
      const touched: [string, BufferEntry][] = [];
      for (const path of paths) {
        const existing = current.get(path);
        if (!existing || existing.dirty) continue;
        const raw = await fsReadFile(rootId, path).catch(() => null);
        if (raw === null) continue;
        const text = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(raw));
        touched.push([
          path,
          {
            diskText: text,
            text,
            dirty: false,
            savedAt: existing.savedAt,
            externalVersion: existing.externalVersion + 1,
          },
        ]);
      }
      if (touched.length === 0) return;
      const next = new Map(get().buffers);
      for (const [p, b] of touched) next.set(p, b);
      set({ buffers: next });
    },
  }));
}
