import { PlanFileSchema } from "@obelus/claude-sidecar";
import type { DiffHunkRow, Repository } from "@obelus/repo";
import { fsReadDir, fsReadFile } from "../../ipc/commands";

export interface IngestPlanInput {
  repo: Repository;
  rootId: string;
  sessionId: string;
}

export interface IngestPlanResult {
  planPath: string;
  planBundleId: string;
  sessionBundleId: string;
  blockCount: number;
  hunkCount: number;
  droppedForUnknownAnnotation: string[];
  scannedPlans: string[];
}

function basename(p: string): string {
  const slash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return slash < 0 ? p : p.slice(slash + 1);
}

export async function ingestPlanFile(input: IngestPlanInput): Promise<IngestPlanResult> {
  const { repo, rootId, sessionId } = input;

  const session = await repo.reviewSessions.get(sessionId);
  if (!session) throw new Error(`review session ${sessionId} not found`);
  const sessionBundleBasename = basename(session.bundleId);

  const revisions = await repo.revisions.listForPaper(session.paperId);
  const latest = revisions[revisions.length - 1];
  if (!latest) throw new Error(`paper ${session.paperId} has no revision`);
  const annotations = await repo.annotations.listForRevision(latest.id, {
    includeResolved: true,
  });
  const knownAnnotationIds = new Set(annotations.map((a) => a.id));

  const entries = await fsReadDir(rootId, ".obelus").catch(() => []);
  const planNames = entries
    .map((e) => e.name)
    .filter((n) => /^plan-.*\.json$/.test(n))
    .sort()
    .reverse();

  if (planNames.length === 0) {
    throw new Error("no plan file found under .obelus/");
  }

  // Walk plans newest-first; stop at the first one whose bundleId basename
  // matches the session's bundle. A corrupt historic plan is skipped so it
  // can't mask a valid later match.
  let picked: { name: string; plan: ReturnType<typeof PlanFileSchema.parse> } | null = null;
  const scannedPlans: string[] = [];
  for (const name of planNames) {
    try {
      const buffer = await fsReadFile(rootId, `.obelus/${name}`);
      const text = new TextDecoder().decode(new Uint8Array(buffer));
      const plan = PlanFileSchema.parse(JSON.parse(text));
      const planBundle = basename(plan.bundleId);
      scannedPlans.push(`${name} -> ${planBundle}`);
      if (planBundle === sessionBundleBasename) {
        picked = { name, plan };
        break;
      }
    } catch (err) {
      scannedPlans.push(`${name} -> unreadable (${err instanceof Error ? err.message : "?"})`);
    }
  }

  if (!picked) {
    throw new Error(
      `no plan matched session bundle ${sessionBundleBasename}; scanned ${scannedPlans.length} plan file(s): ${scannedPlans.join("; ")}`,
    );
  }

  const droppedForUnknownAnnotation: string[] = [];
  const keptBlocks = picked.plan.blocks.filter((b) => {
    if (knownAnnotationIds.has(b.annotationId)) return true;
    droppedForUnknownAnnotation.push(b.annotationId);
    return false;
  });

  const rows: DiffHunkRow[] = keptBlocks.map((b, i) => ({
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

  return {
    planPath: `.obelus/${picked.name}`,
    planBundleId: picked.plan.bundleId,
    sessionBundleId: session.bundleId,
    blockCount: picked.plan.blocks.length,
    hunkCount: rows.length,
    droppedForUnknownAnnotation,
    scannedPlans,
  };
}
