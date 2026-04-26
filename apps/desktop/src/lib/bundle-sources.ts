// Snapshots the source files a bundle points at, so the desktop can detect
// the "Claude edited the source directly instead of writing a plan" failure
// mode (see `packages/claude-plugin/skills/apply-revision/SKILL.md` → "Tool
// policy"). The snapshot is taken before spawning Claude and compared on
// exit; any file whose sha256 changed is listed in the diagnostic.
import { fsStat } from "../ipc/commands";

export interface BundleSourceSnapshot {
  // relPath → sha256 + size at the moment the snapshot was taken. Missing
  // entries mean the file was unreadable (e.g. bundle points at a path that
  // doesn't exist) — we skip those rather than fail the whole snapshot.
  readonly bySha: ReadonlyMap<string, { sha256: string; size: number }>;
}

export interface BundleLike {
  papers?: ReadonlyArray<{ entrypoint?: string | null; pdf?: { relPath?: string | null } | null }>;
  annotations?: ReadonlyArray<{
    anchor?: { kind?: string; file?: string | null } | null;
  }>;
}

export function collectBundleSourcePaths(bundle: BundleLike): string[] {
  const set = new Set<string>();
  for (const p of bundle.papers ?? []) {
    if (typeof p.entrypoint === "string" && p.entrypoint.length > 0) set.add(p.entrypoint);
  }
  for (const a of bundle.annotations ?? []) {
    const file = a.anchor?.file;
    if (typeof file === "string" && file.length > 0) set.add(file);
  }
  return [...set];
}

export async function snapshotBundleSources(
  rootId: string,
  paths: ReadonlyArray<string>,
): Promise<BundleSourceSnapshot> {
  const entries = await Promise.all(
    paths.map(async (p): Promise<[string, { sha256: string; size: number }] | null> => {
      try {
        const stat = await fsStat(rootId, p);
        return [p, { sha256: stat.sha256, size: stat.size }];
      } catch {
        return null;
      }
    }),
  );
  const bySha = new Map<string, { sha256: string; size: number }>();
  for (const e of entries) {
    if (e) bySha.set(e[0], e[1]);
  }
  return { bySha };
}

export async function sourcesDiffSincePresnap(
  rootId: string,
  snapshot: BundleSourceSnapshot,
): Promise<string[]> {
  const changed: string[] = [];
  for (const [relPath, pre] of snapshot.bySha) {
    try {
      const stat = await fsStat(rootId, relPath);
      if (stat.sha256 !== pre.sha256) changed.push(relPath);
    } catch {
      // File disappeared entirely — count that as a change.
      changed.push(relPath);
    }
  }
  return changed;
}

// Per-review-session source snapshots. Populated by `review-runner.start()`
// right before spawning Claude; consumed by `jobs-listener.handleExit()` to
// detect the "Claude bypassed plan-fix and edited source directly" failure
// mode. Keyed by reviewSessionId (stable across the spawn → exit round-trip
// even before the claudeSessionId is known).
const snapshotsByReviewSession = new Map<string, BundleSourceSnapshot>();

export function stashSnapshotForSession(reviewSessionId: string, snap: BundleSourceSnapshot): void {
  snapshotsByReviewSession.set(reviewSessionId, snap);
}

export function takeSnapshotForSession(reviewSessionId: string): BundleSourceSnapshot | undefined {
  const snap = snapshotsByReviewSession.get(reviewSessionId);
  if (snap) snapshotsByReviewSession.delete(reviewSessionId);
  return snap;
}
