import { PlanFileSchema, pickLatestPlanName } from "@obelus/claude-sidecar";
import type { DiffHunkRow, Repository } from "@obelus/repo";
import { fsReadDir, fsReadFile } from "../../ipc/commands";

export interface IngestPlanInput {
  repo: Repository;
  rootId: string;
  sessionId: string;
}

export interface IngestPlanResult {
  planPath: string;
  hunkCount: number;
}

export async function ingestPlanFile(input: IngestPlanInput): Promise<IngestPlanResult> {
  const { repo, rootId, sessionId } = input;
  const entries = await fsReadDir(rootId, ".obelus").catch(() => []);
  const names = entries.map((e) => e.name);
  const picked = pickLatestPlanName(names);
  if (!picked) {
    throw new Error("no plan file found under .obelus/");
  }
  const buffer = await fsReadFile(rootId, `.obelus/${picked}`);
  const text = new TextDecoder().decode(new Uint8Array(buffer));
  const plan = PlanFileSchema.parse(JSON.parse(text));

  const rows: DiffHunkRow[] = plan.blocks.map((b, i) => ({
    id: crypto.randomUUID(),
    sessionId,
    annotationId: b.annotationId,
    file: b.file,
    category: b.category,
    patch: b.patch,
    modifiedPatchText: null,
    state: "pending",
    ambiguous: b.ambiguous,
    noteText: "",
    ordinal: i,
  }));

  await repo.diffHunks.upsertMany(sessionId, rows);
  return { planPath: `.obelus/${picked}`, hunkCount: rows.length };
}
