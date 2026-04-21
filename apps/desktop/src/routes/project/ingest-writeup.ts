import { pickLatestWriteupName } from "@obelus/claude-sidecar";
import { fsReadDir, fsReadFile } from "../../ipc/commands";

export interface IngestWriteupInput {
  rootId: string;
  paperId: string;
}

export interface IngestWriteupResult {
  path: string;
  body: string;
}

export async function ingestWriteupFile(
  input: IngestWriteupInput,
): Promise<IngestWriteupResult | null> {
  const { rootId, paperId } = input;
  const entries = await fsReadDir(rootId, ".obelus").catch(() => []);
  const names = entries.map((e) => e.name);
  const picked = pickLatestWriteupName(names, paperId);
  if (!picked) return null;
  const buffer = await fsReadFile(rootId, `.obelus/${picked}`);
  const body = new TextDecoder().decode(new Uint8Array(buffer));
  return { path: `.obelus/${picked}`, body };
}
