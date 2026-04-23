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

// Returned from a `writeGuard` to veto a save. The string is surfaced on the
// error thrown back to the caller so the UI can explain why the write was
// blocked. `null` means "no opinion" — the save proceeds.
export type WriteGuardReason = string | null;

export interface BuffersState {
  rootId: string;
  buffers: Map<string, BufferEntry>;
  currentPath: string | null;
  pendingSwitch: string | null;
  // Defense-in-depth against writes while a review is pending. The source
  // pane's CodeMirror is already set to read-only in that state, so most
  // paths never reach here — but the save command and any future "save all"
  // control would, so the store itself owns the veto.
  writeGuard: ((path: string) => WriteGuardReason) | null;

  setCurrentPath(path: string | null): void;
  setWriteGuard(guard: ((path: string) => WriteGuardReason) | null): void;
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
  // Rewrites buffer keys after a file/folder move. Exact matches on
  // `fromPrefix` are replaced with `toPrefix`; matches on `fromPrefix + "/"`
  // are rewritten prefix-wise.
  renamePath(fromPrefix: string, toPrefix: string): void;
}

export type BuffersStore = UseBoundStore<StoreApi<BuffersState>>;

export function createBuffersStore(rootId: string): BuffersStore {
  return create<BuffersState>()((set, get) => ({
    rootId,
    buffers: new Map(),
    currentPath: null,
    pendingSwitch: null,
    writeGuard: null,

    setCurrentPath(path: string | null): void {
      set({ currentPath: path, pendingSwitch: null });
    },

    setWriteGuard(guard): void {
      set({ writeGuard: guard });
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
      const veto = get().writeGuard?.(path) ?? null;
      if (veto !== null) {
        // Surface as a thrown error rather than a silent no-op — the caller
        // (⌘S handler or save button) can display it; a silent ignore would
        // leave the user wondering why their keystroke did nothing.
        throw new Error(veto);
      }
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

    renamePath(fromPrefix: string, toPrefix: string): void {
      if (fromPrefix === toPrefix) return;
      const { buffers, currentPath } = get();
      const next = new Map<string, BufferEntry>();
      let changed = false;
      for (const [path, entry] of buffers.entries()) {
        const rewritten =
          path === fromPrefix
            ? toPrefix
            : path.startsWith(`${fromPrefix}/`)
              ? `${toPrefix}${path.slice(fromPrefix.length)}`
              : path;
        if (rewritten !== path) changed = true;
        next.set(rewritten, entry);
      }
      const nextCurrent =
        currentPath === fromPrefix
          ? toPrefix
          : currentPath?.startsWith(`${fromPrefix}/`)
            ? `${toPrefix}${currentPath.slice(fromPrefix.length)}`
            : currentPath;
      if (!changed && nextCurrent === currentPath) return;
      set({ buffers: next, currentPath: nextCurrent });
    },
  }));
}
