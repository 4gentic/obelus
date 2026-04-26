import { type PlanBlock, type PlanEmptyReason, PlanFileSchema } from "@obelus/claude-sidecar";
import type { DiffHunkRow, Repository } from "@obelus/repo";
import { workspacePath, workspaceReadDir, workspaceReadFile } from "../../ipc/commands";
import { paperHasSources } from "../../lib/paper-has-sources";

// Format a parse-time error into one user-friendly line. Zod's default message
// dumps every issue with stack-style indentation; for the status bar we want
// the first issue's path + hint, so the user can tell whether the plan file is
// malformed at the top level or one block deep. Duck-typed against ZodError to
// avoid pulling `zod` into the desktop's direct dependency set.
interface ZodIssueLike {
  path: ReadonlyArray<string | number>;
  message: string;
}

function formatZodPath(path: ReadonlyArray<string | number>): string {
  let out = "";
  for (const seg of path) {
    if (typeof seg === "number") {
      out += `[${seg}]`;
    } else {
      out += out === "" ? seg : `.${seg}`;
    }
  }
  return out;
}

function describeParseError(err: unknown): string {
  if (
    err !== null &&
    typeof err === "object" &&
    "issues" in err &&
    Array.isArray((err as { issues: unknown }).issues)
  ) {
    const issues = (err as { issues: ReadonlyArray<ZodIssueLike> }).issues;
    const issue = issues[0];
    if (!issue) return "invalid plan JSON";
    const path = issue.path.length > 0 ? formatZodPath(issue.path) : "(root)";
    return `invalid plan JSON at ${path}: ${issue.message}`;
  }
  if (err instanceof SyntaxError) {
    return `plan JSON is not valid JSON: ${err.message}`;
  }
  return err instanceof Error ? err.message : "?";
}

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
  // Count of blocks where one diff satisfies more than one user mark — the
  // common case once the planner reasons holistically over a paper. Surfaced
  // in the status bar so the user can tell "3 changes" apart from "3 changes
  // (2 cover multiple marks)".
  multiMarkDiffs: number;
  // Tally of empty-patch blocks broken down by reason. Empty blocks never
  // appear in the diff list (the UI filters them); they live as margin-mark
  // status badges. Counts here let the status bar report what the agent
  // actually said about each mark.
  emptyByReason: Record<PlanEmptyReason, number>;
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
  "directive-",
  "compile-",
] as const;

export function isSynthesisedAnnotationId(id: string): boolean {
  return SYNTHESISED_ID_PREFIXES.some((prefix) => id.startsWith(prefix));
}

export interface PlanBlockLike {
  annotationIds: ReadonlyArray<string>;
}

export interface PartitionedBlocks<T extends PlanBlockLike> {
  kept: T[];
  // Each entry names the block's full id list (joined with "+") so the log
  // can tell "single mark dropped because it's stale" apart from "merged
  // block dropped because one of its three marks is unknown".
  droppedForUnknownAnnotation: string[];
  synthesisedKept: number;
}

// A block is synthesised iff its first id has a synthesised prefix. The
// planner contract is that synthesised blocks carry a singleton array; mixed
// arrays (real UUID + synthesised id) are not produced. We treat any block
// whose first id is synthesised as synthesised.
function isSynthesisedBlock(b: PlanBlockLike): boolean {
  const first = b.annotationIds[0];
  return typeof first === "string" && isSynthesisedAnnotationId(first);
}

export function partitionPlanBlocks<T extends PlanBlockLike>(
  blocks: readonly T[],
  knownAnnotationIds: ReadonlySet<string>,
): PartitionedBlocks<T> {
  const kept: T[] = [];
  const droppedForUnknownAnnotation: string[] = [];
  let synthesisedKept = 0;
  for (const b of blocks) {
    if (isSynthesisedBlock(b)) {
      synthesisedKept += 1;
      kept.push(b);
      continue;
    }
    // User-mark block: drop the whole block if any contributing mark is
    // unknown. The diff was authored to satisfy *all* its marks; surfacing a
    // partially-attributed merged diff would mislead the reviewer about what
    // they're accepting.
    const allKnown = b.annotationIds.every((id) => knownAnnotationIds.has(id));
    if (allKnown) {
      kept.push(b);
      continue;
    }
    droppedForUnknownAnnotation.push(b.annotationIds.join("+"));
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
    const tHint = performance.now();
    const rel = toWorkspaceRel(workspaceAbs, hintPath);
    if (rel === null) {
      scannedPlans.push(`${hintPath} (marker) -> rejected: outside workspace`);
      console.info("[write-perf]", {
        step: "ingest:hint",
        ms: Math.round(performance.now() - tHint),
        picked: false,
        error: "outside-workspace",
      });
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
        console.info("[write-perf]", {
          step: "ingest:hint",
          ms: Math.round(performance.now() - tHint),
          picked: picked !== null,
          bytes: buffer.byteLength,
        });
      } catch (err) {
        scannedPlans.push(`${rel} (marker) -> unreadable (${describeParseError(err)})`);
        console.info("[write-perf]", {
          step: "ingest:hint",
          ms: Math.round(performance.now() - tHint),
          picked: false,
          error: describeParseError(err),
        });
      }
    }
  }

  let directoryNames: string[] = [];
  if (!picked) {
    const tScan = performance.now();
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
      // .md plans without a .json companion are a partial-run signal: the
      // skill wrote the human-readable artifact but skipped the
      // machine-readable one the desktop ingests. Surfacing this is more
      // useful than blaming the spawn prompt, which usually did reach the
      // model — the trouble is downstream of invocation.
      const orphanedMd = directoryNames.filter((n) => /^plan-.+\.md$/.test(n));
      const dirSummary = directoryNames.join(", ") || "(empty)";
      const headline =
        orphanedMd.length > 0
          ? `Claude wrote a plan markdown but no .json companion the desktop can ingest.`
          : `Claude finished without writing a plan file under the project workspace.`;
      const details =
        orphanedMd.length > 0
          ? `Found .md plan(s) with no .json sibling: ${orphanedMd.join(", ")}. The skill needs to write both files with matching timestamps; check the job log for an OBELUS_WROTE: marker (absent if the skill exited before the json Write call).`
          : `The session ended cleanly but emitted no \`OBELUS_WROTE:\` marker and left no plan-*.json behind. Possible causes: the model didn't dispatch the skill (look for tool calls hunting for "plan-writer-fast" or "apply-revision" by name in the job log), or the skill aborted before writing. Workspace contents: ${dirSummary}.`;
      throw new Error(`${headline}\n\n${details}`);
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
        scannedPlans.push(`${name} -> unreadable (${describeParseError(err)})`);
      }
    }
    console.info("[write-perf]", {
      step: "ingest:scan",
      ms: Math.round(performance.now() - tScan),
      picked: picked !== null,
      planNames: planNames.length,
    });
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
      : `The session ended cleanly but no .json plan was written. Check the job log for an OBELUS_WROTE: marker — its absence means the skill never reached its Write call.`;
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
    annotationIds: [...b.annotationIds],
    file: b.file,
    category: b.category,
    patch: b.patch,
    modifiedPatchText: null,
    state: "pending",
    ambiguous: b.ambiguous,
    emptyReason: b.emptyReason,
    noteText: "",
    reviewerNotes: b.reviewerNotes,
    ordinal: i,
    applyFailure: null,
  }));

  await repo.diffHunks.upsertMany(sessionId, rows);

  const ambiguousCount = keptBlocks.reduce((n, b) => n + (b.ambiguous ? 1 : 0), 0);
  const multiMarkDiffs = keptBlocks.reduce((n, b) => n + (b.annotationIds.length > 1 ? 1 : 0), 0);
  const emptyByReason = tallyEmptyReasons(keptBlocks);

  console.info("[ingest-plan]", {
    sessionId,
    planPath: picked.name,
    blockCount: picked.plan.blocks.length,
    hunkCount: rows.length,
    ambiguousCount,
    multiMarkDiffs,
    emptyByReason,
    synthesisedKept,
    droppedForUnknownAnnotation,
  });

  return {
    planPath: picked.name,
    planBundleId: picked.plan.bundleId,
    sessionBundleId: session.bundleId,
    blockCount: picked.plan.blocks.length,
    hunkCount: rows.length,
    ambiguousCount,
    multiMarkDiffs,
    emptyByReason,
    droppedForUnknownAnnotation,
    synthesisedKept,
    scannedPlans,
    hasSources,
  };
}

function tallyEmptyReasons(blocks: ReadonlyArray<PlanBlock>): Record<PlanEmptyReason, number> {
  const counts: Record<PlanEmptyReason, number> = {
    praise: 0,
    ambiguous: 0,
    "structural-note": 0,
    "no-edit-requested": 0,
  };
  for (const b of blocks) {
    if (b.emptyReason !== null) counts[b.emptyReason] += 1;
  }
  return counts;
}
