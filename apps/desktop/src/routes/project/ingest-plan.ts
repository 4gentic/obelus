import { PlanFileSchema } from "@obelus/claude-sidecar";
import type { DiffHunkRow, Repository } from "@obelus/repo";
import { workspacePath, workspaceReadDir, workspaceReadFile } from "../../ipc/commands";
import { paperHasSources } from "../../lib/paper-has-sources";

export interface IngestPlanInput {
  repo: Repository;
  projectId: string;
  sessionId: string;
  // Optional absolute path the plugin printed in its `OBELUS_WROTE: <path>`
  // marker. Tried first; if it parses as a PlanFile and its bundleId matches
  // the session, the workspace scan is skipped. Anything outside the
  // project workspace is refused.
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

function toWorkspaceRel(workspaceAbs: string, hintPath: string): string | null {
  const normalisedAbs = workspaceAbs.endsWith("/") ? workspaceAbs : `${workspaceAbs}/`;
  if (!hintPath.startsWith(normalisedAbs)) return null;
  return hintPath.slice(normalisedAbs.length);
}

export async function ingestPlanFile(input: IngestPlanInput): Promise<IngestPlanResult> {
  const { repo, projectId, sessionId, hintPath } = input;
  const workspaceAbs = await workspacePath(projectId, "");

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
    const rel = toWorkspaceRel(workspaceAbs, hintPath);
    if (rel === null) {
      scannedPlans.push(`${hintPath} (marker) -> rejected: outside workspace`);
    } else {
      try {
        const buffer = await workspaceReadFile(projectId, rel);
        const text = new TextDecoder().decode(new Uint8Array(buffer));
        const plan = PlanFileSchema.parse(JSON.parse(text));
        const planBundle = basename(plan.bundleId);
        scannedPlans.push(`${rel} (marker) -> ${planBundle}`);
        if (planBundle === sessionBundleBasename) {
          picked = { name: basename(rel), plan };
        }
      } catch (err) {
        scannedPlans.push(
          `${rel} (marker) -> unreadable (${err instanceof Error ? err.message : "?"})`,
        );
      }
    }
  }

  let directoryNames: string[] = [];
  if (!picked) {
    const entries = await workspaceReadDir(projectId, ".").catch(() => []);
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
      const details = `Usually this means the spawn prompt reached Claude without the "Run apply-revision" trigger — check the job log. Workspace contents: ${directoryNames.join(", ") || "(empty)"}`;
      throw new Error(
        `Claude finished without writing a plan file under the project workspace.\n\n${details}`,
      );
    }

    // Walk plans newest-first; stop at the first one whose bundleId basename
    // matches the session's bundle. A corrupt historic plan is skipped so it
    // can't mask a valid later match.
    for (const name of planNames) {
      try {
        const buffer = await workspaceReadFile(projectId, name);
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
      directoryNames.length > 0 ? `; workspace contains: ${directoryNames.join(", ")}` : "";
    const scannedSummary = scannedPlans.join("; ") || "(none)";
    const wroteAnyPlan = scannedPlans.length > 0;
    const headline = wroteAnyPlan
      ? "No plan matched this run's bundle — Claude may have decided the marks were already applied in your working tree."
      : `Claude finished but wrote no plan file matching bundle ${sessionBundleBasename}.`;
    const detailsLeadIn = wroteAnyPlan
      ? `Session bundle: ${sessionBundleBasename}. The plans on disk reference older bundles.`
      : 'Usually this means the spawn prompt reached Claude without the "Run apply-revision" trigger — check the job log.';
    const details = `${detailsLeadIn} Scanned ${scannedPlans.length} plan file(s): ${scannedSummary}${dirSummary}`;
    throw new Error(`${headline}\n\n${details}`);
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
    planPath: picked.name,
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
