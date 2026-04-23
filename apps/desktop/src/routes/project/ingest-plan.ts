import { PlanFileSchema } from "@obelus/claude-sidecar";
import type { DiffHunkRow, Repository } from "@obelus/repo";
import { fsReadDir, fsReadFile } from "../../ipc/commands";

export interface IngestPlanInput {
  repo: Repository;
  rootId: string;
  sessionId: string;
  // Optional path the plugin printed in its `OBELUS_WROTE: <path>` marker. We
  // try it first; if it parses as a PlanFile and its bundleId matches the
  // session, we skip the directory scan entirely.
  hintPath?: string;
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
  const { repo, rootId, sessionId, hintPath } = input;

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

  let picked: { name: string; plan: ReturnType<typeof PlanFileSchema.parse> } | null = null;
  const scannedPlans: string[] = [];

  if (hintPath?.endsWith(".json")) {
    try {
      const buffer = await fsReadFile(rootId, hintPath);
      const text = new TextDecoder().decode(new Uint8Array(buffer));
      const plan = PlanFileSchema.parse(JSON.parse(text));
      const planBundle = basename(plan.bundleId);
      scannedPlans.push(`${hintPath} (marker) -> ${planBundle}`);
      if (planBundle === sessionBundleBasename) {
        picked = { name: basename(hintPath), plan };
      }
    } catch (err) {
      scannedPlans.push(
        `${hintPath} (marker) -> unreadable (${err instanceof Error ? err.message : "?"})`,
      );
    }
  }

  let directoryNames: string[] = [];
  if (!picked) {
    const entries = await fsReadDir(rootId, ".obelus").catch(() => []);
    directoryNames = entries.map((e) => e.name);
    const planNames = directoryNames
      .filter((n) => /^plan-.+\.json$/.test(n) || n === "plan.json")
      .sort()
      .reverse();

    if (planNames.length === 0 && scannedPlans.length === 0) {
      throw new Error(
        `no plan file found under .obelus/; directory contents: ${directoryNames.join(", ") || "(empty)"}`,
      );
    }

    // Walk plans newest-first; stop at the first one whose bundleId basename
    // matches the session's bundle. A corrupt historic plan is skipped so it
    // can't mask a valid later match.
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
  }

  if (!picked) {
    const dirSummary =
      directoryNames.length > 0 ? `; .obelus/ contains: ${directoryNames.join(", ")}` : "";
    throw new Error(
      `no plan matched session bundle ${sessionBundleBasename}; scanned ${scannedPlans.length} plan file(s): ${scannedPlans.join("; ") || "(none)"}${dirSummary}`,
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
