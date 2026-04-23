import { pickLatestWriteupName } from "@obelus/claude-sidecar";
import { fsReadDir, fsReadFile } from "../../ipc/commands";

export interface IngestWriteupInput {
  rootId: string;
  paperId: string;
  // Optional path the plugin printed in its `OBELUS_WROTE: <path>` marker.
  // When present, this is tried before the directory scan — it lets us pick up
  // a writeup the plugin wrote to a non-canonical path (e.g. a smaller model
  // dropped the timestamp segment, or wrote to the project root by mistake).
  hintPath?: string;
}

export interface IngestWriteupResult {
  path: string;
  body: string;
}

async function readBody(rootId: string, relPath: string): Promise<string | null> {
  try {
    const buffer = await fsReadFile(rootId, relPath);
    return new TextDecoder().decode(new Uint8Array(buffer));
  } catch {
    return null;
  }
}

export async function ingestWriteupFile(
  input: IngestWriteupInput,
): Promise<IngestWriteupResult | null> {
  const { rootId, paperId, hintPath } = input;

  if (hintPath?.endsWith(".md")) {
    const body = await readBody(rootId, hintPath);
    if (body !== null) {
      console.info("[ingest-writeup]", { matchedVia: "marker", path: hintPath });
      return { path: hintPath, body };
    }
    console.warn("[ingest-writeup]", {
      matchedVia: "marker-miss",
      path: hintPath,
      reason: "marker path not readable, falling back to directory scan",
    });
  }

  const entries = await fsReadDir(rootId, ".obelus").catch(() => []);
  const names = entries.map((e) => e.name);
  const picked = pickLatestWriteupName(names, paperId);
  if (!picked) return null;
  const body = await readBody(rootId, `.obelus/${picked}`);
  if (body === null) return null;
  console.info("[ingest-writeup]", {
    matchedVia: "directory-scan",
    path: `.obelus/${picked}`,
    scanned: names.length,
  });
  return { path: `.obelus/${picked}`, body };
}
