import type { PaperEditRow } from "@obelus/repo";
import { type JSX, useCallback, useMemo, useState } from "react";
import { historyCheckout, historyDetectDivergence } from "../../ipc/commands";
import { useBuffersStore } from "./buffers-store-context";
import { useProject } from "./context";
import { scanAfterCheckout } from "./history-actions";
import { useReviewRunner } from "./review-runner-context";
import { usePaperEdits } from "./use-paper-edits";

// A compact, horizontal version selector for source files. Surfaces the same
// paper_edits timeline as DraftsPanel but without the fold / discard / pending
// UI — clicking a chip checks out that draft for the whole project and lets
// CodeMirror re-read the bytes. No schema change: the existing manifest_sha256
// already snapshots every source file.
export default function DraftsRail(): JSX.Element | null {
  const { project, repo, rootId } = useProject();
  const runner = useReviewRunner();
  const buffers = useBuffersStore();
  const edits = usePaperEdits(repo, project.id);
  const [banner, setBanner] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const runnerBusy =
    runner.status.kind === "working" ||
    runner.status.kind === "running" ||
    runner.status.kind === "ingesting";

  const sortedLive = useMemo(
    () => [...edits.live].sort((a, b) => b.ordinal - a.ordinal),
    [edits.live],
  );
  const currentId = edits.currentDraftId ?? edits.head?.id;
  const current = sortedLive.find((e) => e.id === currentId) ?? null;

  const open = useCallback(
    async (target: PaperEditRow) => {
      if (runnerBusy || working) return;
      if (target.id === currentId) return;
      setBanner(null);
      setWorking(true);
      try {
        const sourceManifest = current?.manifestSha256 ?? edits.head?.manifestSha256;
        if (!sourceManifest) {
          setBanner("No current draft to compare against.");
          return;
        }
        const dirty = buffers.getState().dirtyPaths();
        if (dirty.length > 0) {
          setBanner(`Save or discard unsaved edits first (${dirty.length} file(s)).`);
          return;
        }
        const div = await historyDetectDivergence(rootId, sourceManifest);
        if (div.modified.length > 0 || div.added.length > 0 || div.missing.length > 0) {
          setBanner(
            `Working tree diverged (${div.modified.length + div.added.length + div.missing.length} files). Save or revert to switch drafts.`,
          );
          return;
        }
        await historyCheckout({ rootId, targetManifestSha: target.manifestSha256 });
        await edits.setCurrentDraftId(target.id);
        const openPaths = Array.from(buffers.getState().buffers.keys());
        if (openPaths.length > 0) await buffers.getState().refreshFromDisk(openPaths);
        void scanAfterCheckout({ repo, project, rootId }).catch(() => {});
      } catch (err) {
        setBanner(err instanceof Error ? err.message : "Could not open draft.");
      } finally {
        setWorking(false);
      }
    },
    [runnerBusy, working, currentId, current, edits, buffers, rootId, repo, project],
  );

  if (sortedLive.length === 0) return null;

  return (
    <div className="drafts-rail">
      {banner && <span className="drafts-rail__banner">{banner}</span>}
      <ol className="drafts-rail__list">
        {sortedLive.map((d) => {
          const isCurrent = d.id === currentId;
          return (
            <li key={d.id}>
              <button
                type="button"
                className="drafts-rail__chip"
                data-current={isCurrent ? "true" : "false"}
                disabled={runnerBusy || working}
                onClick={() => void open(d)}
                title={d.summary || `Draft ${d.ordinal}`}
              >
                <span className="drafts-rail__ord">{d.ordinal}</span>
                {d.kind === "baseline" ? <span className="drafts-rail__tag">base</span> : null}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
