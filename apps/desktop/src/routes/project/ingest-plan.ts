import { PlanFileSchema } from "@obelus/claude-sidecar";
import type { DiffHunkRow, Repository } from "@obelus/repo";
import { fsReadDir, fsReadFile } from "../../ipc/commands";
import { paperHasSources } from "../../lib/paper-has-sources";

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
  ambiguousCount: number;
  droppedForUnknownAnnotation: string[];
  synthesisedKept: number;
  scannedPlans: string[];
  hasSources: boolean;
}

// Synthesised blocks carry IDs the planner invents (they have no row in the
// annotations table). They still need to reach the diff-review UI so the user
// can accept/reject each; without this allowlist they would be silently
// dropped by the knownAnnotationIds gate below.
export const SYNTHESISED_ID_PREFIXES = [
  "cascade-",
  "impact-",
  "coherence-",
  "quality-",
  "compile-",
] as const;

export function isSynthesisedAnnotationId(id: string): boolean {
  return SYNTHESISED_ID_PREFIXES.some((prefix) => id.startsWith(prefix));
}

export interface PlanBlockLike {
  annotationId: string;
}

export interface PartitionedBlocks<T extends PlanBlockLike> {
  kept: T[];
  droppedForUnknownAnnotation: string[];
  synthesisedKept: number;
}

export function partitionPlanBlocks<T extends PlanBlockLike>(
  blocks: readonly T[],
  knownAnnotationIds: ReadonlySet<string>,
): PartitionedBlocks<T> {
  const kept: T[] = [];
  const droppedForUnknownAnnotation: string[] = [];
  let synthesisedKept = 0;
  for (const b of blocks) {
    if (isSynthesisedAnnotationId(b.annotationId)) {
      synthesisedKept += 1;
      kept.push(b);
      continue;
    }
    if (knownAnnotationIds.has(b.annotationId)) {
      kept.push(b);
      continue;
    }
    droppedForUnknownAnnotation.push(b.annotationId);
  }
  return { kept, droppedForUnknownAnnotation, synthesisedKept };
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

  const paperBuild = (await repo.paperBuild.get(session.paperId)) ?? null;
  const hasSources = paperHasSources(paperBuild);

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
    // Timestamped plans first (newest → oldest), then the bare fallback. A
    // plain lex sort would put `plan.json` ahead of `plan-<iso>.json` after
    // reverse because `-` < `.`, which lets a stale bare plan shadow the
    // current timestamped one.
    const timestamped = directoryNames
      .filter((n) => /^plan-.+\.json$/.test(n))
      .sort()
      .reverse();
    const planNames = directoryNames.includes("plan.json")
      ? [...timestamped, "plan.json"]
      : timestamped;

    if (planNames.length === 0 && scannedPlans.length === 0) {
      throw new Error(
        `Claude finished without writing a plan file under .obelus/. This usually means the spawn prompt reached Claude without the "Run apply-revision" trigger — check the job log. Directory contents: ${directoryNames.join(", ") || "(empty)"}`,
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
    const scannedSummary = scannedPlans.join("; ") || "(none)";
    const wroteAnyPlan = scannedPlans.length > 0;
    const leadIn = wroteAnyPlan
      ? `Claude finished but no plan file matched this session's bundle ${sessionBundleBasename}; the plans on disk reference older bundles.`
      : `Claude finished but wrote no plan file matching bundle ${sessionBundleBasename}. This usually means the spawn prompt reached Claude without the "Run apply-revision" trigger — check the job log.`;
    throw new Error(
      `${leadIn} Scanned ${scannedPlans.length} plan file(s): ${scannedSummary}${dirSummary}`,
    );
  }

  const {
    kept: keptBlocks,
    droppedForUnknownAnnotation,
    synthesisedKept,
  } = partitionPlanBlocks(picked.plan.blocks, knownAnnotationIds);

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
    applyFailure: null,
  }));

  await repo.diffHunks.upsertMany(sessionId, rows);

  const ambiguousCount = keptBlocks.reduce((n, b) => n + (b.ambiguous ? 1 : 0), 0);

  return {
    planPath: `.obelus/${picked.name}`,
    planBundleId: picked.plan.bundleId,
    sessionBundleId: session.bundleId,
    blockCount: picked.plan.blocks.length,
    hunkCount: rows.length,
    ambiguousCount,
    droppedForUnknownAnnotation,
    synthesisedKept,
    scannedPlans,
    hasSources,
  };
}
