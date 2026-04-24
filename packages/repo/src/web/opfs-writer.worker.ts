/// <reference lib="webworker" />

interface WriteMessage {
  id: number;
  dir: string;
  sha256: string;
  bytes: ArrayBuffer;
}

// Why: with `lib: ["webworker"]`, `self` is `WorkerGlobalScope & typeof globalThis`,
// which doesn't expose `postMessage` — that lives on `DedicatedWorkerGlobalScope`.
// We're authored as a dedicated worker; the cast widens `self` to a type with the
// method we know is there.
const post = self as unknown as Worker;

self.onmessage = async (event: MessageEvent<WriteMessage>) => {
  const { id, dir: dirName, sha256, bytes } = event.data;
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(dirName, { create: true });
    const handle = await dir.getFileHandle(sha256, { create: true });
    const access = await handle.createSyncAccessHandle();
    try {
      access.truncate(0);
      access.write(new Uint8Array(bytes), { at: 0 });
      access.flush();
    } finally {
      access.close();
    }
    post.postMessage({ id, ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    post.postMessage({ id, ok: false, error: message });
  }
};
