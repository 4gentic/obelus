/// <reference lib="webworker" />

interface WriteMessage {
  id: number;
  sha256: string;
  bytes: ArrayBuffer;
}

self.onmessage = async (event: MessageEvent<WriteMessage>) => {
  const { id, sha256, bytes } = event.data;
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("pdfs", { create: true });
    const handle = await dir.getFileHandle(sha256, { create: true });
    const access = await handle.createSyncAccessHandle();
    try {
      access.truncate(0);
      access.write(new Uint8Array(bytes), { at: 0 });
      access.flush();
    } finally {
      access.close();
    }
    (self as unknown as Worker).postMessage({ id, ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    (self as unknown as Worker).postMessage({ id, ok: false, error: message });
  }
};
