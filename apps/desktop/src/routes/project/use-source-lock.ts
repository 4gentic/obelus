import { useJobsStore } from "../../lib/jobs-store";
import { useProject } from "./context";
import { useDiffStore } from "./diff-store-context";

// While a writer-project review is pending (running, ingesting, or completed
// with hunks awaiting apply/discard), the source files are read-only inside
// Obelus. Editing during this window is what creates stale-context hunks.
//
// Scope is the whole project, not the currently-viewed paper: the user's
// mental model is "this project has a review pending — don't touch the
// paper", and the currently-viewed file may not even be a PDF (for writer
// projects, it's usually a .typ/.tex/.md source, which means usePaperId()
// returns null and a paper-scoped status lookup misses entirely).
//
// Reviewer projects have nothing to lock (they hold only PDF annotations), so
// the predicate is always false for `kind === "reviewer"`.
export function useSourceLocked(): boolean {
  const { project } = useProject();
  const busy = useJobsStore((s) => {
    for (const j of Object.values(s.jobs)) {
      if (j.projectId !== project.id) continue;
      if (j.kind !== "review") continue;
      if (j.status === "running" || j.status === "ingesting") return true;
    }
    return false;
  });
  const store = useDiffStore();
  const sessionId = store((s) => s.sessionId);
  const applyStatus = store((s) => s.applyStatus);
  if (project.kind !== "writer") return false;
  // A review is in flight on Claude — hunks are about to target the current
  // source bytes; an edit here would land against a version Claude doesn't
  // know about.
  if (busy) return true;
  // A session is loaded with hunks awaiting apply/discard. `applied` closes
  // the review and releases the lock; every other state (idle-with-session,
  // applying, partial, error) keeps it held.
  if (sessionId !== null && applyStatus.kind !== "applied") return true;
  return false;
}
