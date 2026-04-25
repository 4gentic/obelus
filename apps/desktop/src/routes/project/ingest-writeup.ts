import { pickLatestWriteupName } from "@obelus/claude-sidecar";
import { workspacePath, workspaceReadDir, workspaceReadFile } from "../../ipc/commands";

export interface IngestWriteupInput {
  projectId: string;
  paperId: string;
  // Optional absolute path the plugin printed in its `OBELUS_WROTE: <path>`
  // marker. Tried before the workspace scan — it lets us pick up a writeup
  // the plugin wrote to a non-canonical filename (e.g. a smaller model
  // dropped the timestamp segment). Anything outside the workspace is
  // refused; the plugin must write under `$OBELUS_WORKSPACE_DIR`.
  hintPath?: string;
}

export interface IngestWriteupResult {
  // Workspace-relative path of the writeup (e.g. `writeup-paper-1-…md`).
  path: string;
  body: string;
}

async function readBody(projectId: string, workspaceRelPath: string): Promise<string | null> {
  try {
    const buffer = await workspaceReadFile(projectId, workspaceRelPath);
    return new TextDecoder().decode(new Uint8Array(buffer));
  } catch {
    return null;
  }
}

function toWorkspaceRel(workspaceAbs: string, hintPath: string): string | null {
  const normalisedAbs = workspaceAbs.endsWith("/") ? workspaceAbs : `${workspaceAbs}/`;
  if (!hintPath.startsWith(normalisedAbs)) return null;
  return hintPath.slice(normalisedAbs.length);
}

export async function ingestWriteupFile(
  input: IngestWriteupInput,
): Promise<IngestWriteupResult | null> {
  const { projectId, paperId, hintPath } = input;
  const workspaceAbs = await workspacePath(projectId, "");

  if (hintPath?.endsWith(".md")) {
    const rel = toWorkspaceRel(workspaceAbs, hintPath);
    if (rel === null) {
      console.warn("[ingest-writeup]", {
        matchedVia: "marker-out-of-workspace",
        path: hintPath,
        workspaceAbs,
        reason: "marker path is outside the project workspace; falling back to scan",
      });
    } else {
      const body = await readBody(projectId, rel);
      if (body !== null) {
        console.info("[ingest-writeup]", { matchedVia: "marker", path: rel });
        return { path: rel, body };
      }
      console.warn("[ingest-writeup]", {
        matchedVia: "marker-miss",
        path: rel,
        reason: "marker path not readable, falling back to scan",
      });
    }
  }

  const entries = await workspaceReadDir(projectId, ".").catch(() => []);
  const names = entries.map((e) => e.name);
  const picked = pickLatestWriteupName(names, paperId);
  if (!picked) return null;
  const body = await readBody(projectId, picked);
  if (body === null) return null;
  console.info("[ingest-writeup]", {
    matchedVia: "directory-scan",
    path: picked,
    scanned: names.length,
  });
  return { path: picked, body };
}
