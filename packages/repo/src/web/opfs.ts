export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  let out = "";
  for (let i = 0; i < view.length; i += 1) {
    const byte = view[i] ?? 0;
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

const PDF_DIR = "pdfs";
const MD_DIR = "mds";
const HTML_DIR = "htmls";

async function blobDir(name: string): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(name, { create: true });
}

function isNotFound(err: unknown): boolean {
  return err instanceof DOMException && err.name === "NotFoundError";
}

async function hasBlob(dirName: string, sha256: string): Promise<boolean> {
  try {
    const dir = await blobDir(dirName);
    await dir.getFileHandle(sha256);
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

async function getBlob(dirName: string, sha256: string): Promise<ArrayBuffer | null> {
  try {
    const dir = await blobDir(dirName);
    const handle = await dir.getFileHandle(sha256);
    const file = await handle.getFile();
    return await file.arrayBuffer();
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

async function deleteBlob(dirName: string, sha256: string): Promise<void> {
  try {
    const dir = await blobDir(dirName);
    await dir.removeEntry(sha256);
  } catch {
    // Swallow: the file may already be gone, or OPFS is unavailable. The
    // paper/revision rows are already deleted, so the worst case is a
    // harmless orphan blob on disk.
  }
}

export async function hasPdf(sha256: string): Promise<boolean> {
  return hasBlob(PDF_DIR, sha256);
}

export async function getPdf(sha256: string): Promise<ArrayBuffer | null> {
  return getBlob(PDF_DIR, sha256);
}

export async function hasMd(sha256: string): Promise<boolean> {
  return hasBlob(MD_DIR, sha256);
}

export async function getMd(sha256: string): Promise<ArrayBuffer | null> {
  return getBlob(MD_DIR, sha256);
}

export async function getMdText(sha256: string): Promise<string | null> {
  const bytes = await getBlob(MD_DIR, sha256);
  if (bytes === null) return null;
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

export async function hasHtml(sha256: string): Promise<boolean> {
  return hasBlob(HTML_DIR, sha256);
}

export async function getHtml(sha256: string): Promise<string | null> {
  const bytes = await getBlob(HTML_DIR, sha256);
  if (bytes === null) return null;
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

let writer: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: () => void; reject: (err: Error) => void }>();

function getWriter(): Worker {
  if (writer) return writer;
  writer = new Worker(new URL("./opfs-writer.worker.ts", import.meta.url), {
    type: "module",
  });
  writer.onmessage = (event: MessageEvent<{ id: number; ok: boolean; error?: string }>) => {
    const entry = pending.get(event.data.id);
    if (!entry) return;
    pending.delete(event.data.id);
    if (event.data.ok) entry.resolve();
    else entry.reject(new Error(event.data.error ?? "opfs write failed"));
  };
  return writer;
}

async function writeViaWorker(dir: string, sha256: string, bytes: ArrayBuffer): Promise<void> {
  const w = getWriter();
  nextId += 1;
  const id = nextId;
  await new Promise<void>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, dir, sha256, bytes }, [bytes]);
  });
}

export async function putPdf(bytes: ArrayBuffer): Promise<string> {
  const sha256 = await sha256Hex(bytes);
  if (await hasBlob(PDF_DIR, sha256)) return sha256;
  const copy = bytes.slice(0);
  await writeViaWorker(PDF_DIR, sha256, copy);
  return sha256;
}

export async function putMd(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text).buffer as ArrayBuffer;
  const sha256 = await sha256Hex(bytes);
  if (await hasBlob(MD_DIR, sha256)) return sha256;
  // bytes is fresh from the encoder, safe to transfer.
  await writeViaWorker(MD_DIR, sha256, bytes);
  return sha256;
}

export async function putHtml(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text).buffer as ArrayBuffer;
  const sha256 = await sha256Hex(bytes);
  if (await hasBlob(HTML_DIR, sha256)) return sha256;
  await writeViaWorker(HTML_DIR, sha256, bytes);
  return sha256;
}

export async function deletePdf(sha256: string): Promise<void> {
  await deleteBlob(PDF_DIR, sha256);
}

export async function deleteMd(sha256: string): Promise<void> {
  await deleteBlob(MD_DIR, sha256);
}

export async function deleteHtml(sha256: string): Promise<void> {
  await deleteBlob(HTML_DIR, sha256);
}
