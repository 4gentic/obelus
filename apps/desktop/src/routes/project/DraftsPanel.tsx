import type { PaperEditRow } from "@obelus/repo";
import type { JSX } from "react";
import { useCallback, useMemo, useState } from "react";
import { historyCheckout, historyDetectDivergence } from "../../ipc/commands";
import { useBuffersStore } from "./buffers-store-context";
import CompareDrafts from "./CompareDrafts";
import { useProject } from "./context";
import DraftEntry, { type DraftEntryState } from "./DraftEntry";
import { scanAfterCheckout } from "./history-actions";
import { useReviewRunner } from "./review-runner-context";
import { descendantsOf, usePaperEdits } from "./use-paper-edits";

export default function DraftsPanel(): JSX.Element {
  const { project, repo, rootId } = useProject();
  const runner = useReviewRunner();
  const buffers = useBuffersStore();
  const edits = usePaperEdits(repo, project.id);
  const [banner, setBanner] = useState<
    { kind: "idle" } | { kind: "working"; message: string } | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [showDiscarded, setShowDiscarded] = useState(false);
  const [compareTarget, setCompareTarget] = useState<PaperEditRow | null>(null);

  const runnerKind = runner.status.kind;
  const runnerBusy =
    runnerKind === "working" || runnerKind === "running" || runnerKind === "ingesting";
  const busy = runnerBusy || banner.kind === "working";

  const sortedLive = useMemo(
    () => [...edits.live].sort((a, b) => b.ordinal - a.ordinal),
    [edits.live],
  );
  const sortedTombstoned = useMemo(
    () => [...edits.tombstoned].sort((a, b) => b.ordinal - a.ordinal),
    [edits.tombstoned],
  );

  const currentId = edits.currentDraftId;
  const headId = edits.head?.id;

  const currentDraft =
    sortedLive.find((e) => e.id === currentId) ?? sortedLive.find((e) => e.id === headId) ?? null;
  const futureAboveCurrent = useMemo(() => {
    if (!currentDraft) return [];
    return descendantsOf(edits.live, currentDraft.id).reverse();
  }, [edits.live, currentDraft]);

  const onOpen = useCallback(
    async (target: PaperEditRow) => {
      if (busy) return;
      const head = edits.head;
      if (!head) return;
      setBanner({ kind: "working", message: `Opening Draft ${target.ordinal}…` });
      try {
        // Safety: make sure the working tree matches the currently-open
        // manifest before we restore different bytes. Otherwise we'd quietly
        // overwrite hand edits.
        const sourceManifest = currentDraft?.manifestSha256 ?? head.manifestSha256;
        const div = await historyDetectDivergence(rootId, sourceManifest);
        if (div.modified.length > 0 || div.added.length > 0 || div.missing.length > 0) {
          setBanner({
            kind: "error",
            message: divergenceMessage(div),
          });
          return;
        }
        await historyCheckout({
          rootId,
          targetManifestSha: target.manifestSha256,
        });
        await edits.setCurrentDraftId(target.id);
        // The exact set of files that changed isn't known here; refresh every
        // open buffer. Cheap for typical paper projects.
        const openPaths = Array.from(buffers.getState().buffers.keys());
        if (openPaths.length > 0) await buffers.getState().refreshFromDisk(openPaths);
        void scanAfterCheckout({ repo, project, rootId }).catch(() => {});
        setBanner({ kind: "idle" });
      } catch (err) {
        setBanner({
          kind: "error",
          message: err instanceof Error ? err.message : "Could not open draft.",
        });
      }
    },
    [busy, edits, rootId, currentDraft, buffers, repo, project],
  );

  const onRename = useCallback(
    async (target: PaperEditRow, next: string) => {
      await repo.paperEdits.setSummary(target.id, next);
      await edits.refresh();
    },
    [repo, edits.refresh],
  );

  const onFold = useCallback(
    async (target: PaperEditRow) => {
      if (busy) return;
      const head = edits.head;
      if (!head) return;

      // Walk parent links from head back toward target. The chain must be
      // linear — if a branch exists between target and head we refuse rather
      // than silently tombstoning a sibling subtree.
      const byId = new Map(edits.live.map((e) => [e.id, e] as const));
      const chainIds: string[] = [];
      let cursor: PaperEditRow | undefined = head;
      while (cursor && cursor.id !== target.id) {
        chainIds.push(cursor.id);
        cursor = cursor.parentEditId ? byId.get(cursor.parentEditId) : undefined;
      }
      if (!cursor) {
        setBanner({
          kind: "error",
          message: "Can't fold: the drafts between these don't form a linear chain.",
        });
        return;
      }
      chainIds.push(target.id);

      setBanner({ kind: "working", message: "Folding drafts…" });
      try {
        // Create the replacement first so there's never a moment with no live
        // head. If tombstoneMany fails, the user sees two siblings and can
        // recover; if create fails, nothing was disturbed.
        await repo.paperEdits.create({
          projectId: project.id,
          parentEditId: target.parentEditId,
          kind: "manual",
          sessionId: null,
          manifestSha256: head.manifestSha256,
          summary: `Folded Drafts ${target.ordinal}–${head.ordinal}`,
        });
        await repo.paperEdits.tombstoneMany(chainIds);
        await edits.refresh();
        setBanner({ kind: "idle" });
      } catch (err) {
        setBanner({
          kind: "error",
          message: err instanceof Error ? err.message : "Fold failed.",
        });
      }
    },
    [busy, edits.head, edits.live, edits.refresh, repo, project.id],
  );

  const onRecover = useCallback(
    async (target: PaperEditRow) => {
      await repo.paperEdits.restore(target.id);
      await edits.refresh();
    },
    [repo, edits.refresh],
  );

  const compareParent = useMemo<PaperEditRow | null>(() => {
    if (!compareTarget?.parentEditId) return null;
    const all = [...edits.live, ...edits.tombstoned];
    return all.find((e) => e.id === compareTarget.parentEditId) ?? null;
  }, [compareTarget, edits.live, edits.tombstoned]);

  if (compareTarget && compareParent) {
    return (
      <div className="drafts-panel">
        <CompareDrafts
          from={compareParent}
          to={compareTarget}
          onClose={() => setCompareTarget(null)}
        />
      </div>
    );
  }

  if (edits.live.length === 0 && runnerKind !== "running" && runnerKind !== "working") {
    return (
      <div className="drafts-panel">
        <h3 className="drafts-panel__heading">Drafts</h3>
        <p className="drafts-panel__empty-hint">
          <em>
            Drafts accrue as Claude takes each pass and you keep the changes you want. A draft is a
            snapshot — a page from which another page may follow.
          </em>
        </p>
      </div>
    );
  }

  const pendingRow =
    runnerKind === "working" || runnerKind === "running" || runnerKind === "ingesting" ? (
      <article className="draft-entry draft-entry--pending">
        <span className="draft-entry__marker" aria-hidden="true">
          ◌
        </span>
        <div className="draft-entry__body">
          <header className="draft-entry__header">
            <span className="draft-entry__label">A pass is in flight</span>
          </header>
          <p className="draft-entry__note">
            {runnerKind === "working"
              ? "Preparing the bundle…"
              : runnerKind === "ingesting"
                ? "Reading the proposed plan…"
                : "Claude is reviewing your marks."}
          </p>
        </div>
      </article>
    ) : null;

  return (
    <div className="drafts-panel">
      <h3 className="drafts-panel__heading">Drafts</h3>

      {banner.kind === "working" && <p className="drafts-panel__banner">{banner.message}</p>}
      {banner.kind === "error" && (
        <p className="drafts-panel__banner drafts-panel__banner--err">{banner.message}</p>
      )}

      {currentDraft && headId !== currentDraft.id && (
        <p className="drafts-panel__banner drafts-panel__banner--warn">
          You are on Draft {currentDraft.ordinal}. Drafts{" "}
          {futureAboveCurrent.map((d) => d.ordinal).join(", ")} will be discarded if you keep new
          changes.
        </p>
      )}

      <ol className="drafts-panel__list">
        {pendingRow}
        {futureAboveCurrent.map((d) => (
          <li key={d.id}>
            <DraftEntry
              draft={d}
              state="future-faded"
              discardedHint="will be discarded if you keep new changes"
              busy={busy}
              dateLabel={relativeTime(d.createdAt)}
              absoluteDate={absoluteTime(d.createdAt)}
              onOpen={() => onOpen(d)}
              onCompare={() => setCompareTarget(d)}
              onRename={(n) => onRename(d, n)}
            />
          </li>
        ))}
        {currentDraft && futureAboveCurrent.length > 0 && (
          <li className="drafts-panel__here" aria-hidden="true">
            <span className="drafts-panel__here-label">you are here</span>
          </li>
        )}
        {sortedLive
          .filter((d) => !futureAboveCurrent.some((f) => f.id === d.id))
          .map((d) => {
            const isCurrent = d.id === currentDraft?.id;
            const dState: DraftEntryState = isCurrent ? "current" : "past";
            return (
              <li key={d.id}>
                <DraftEntry
                  draft={d}
                  state={dState}
                  busy={busy}
                  dateLabel={relativeTime(d.createdAt)}
                  absoluteDate={absoluteTime(d.createdAt)}
                  {...(dState === "past" ? { onOpen: () => onOpen(d) } : {})}
                  onCompare={() => setCompareTarget(d)}
                  onRename={(n) => onRename(d, n)}
                  {...(dState === "past" && d.id !== headId && edits.head && d.id !== edits.head.id
                    ? { onFold: () => onFold(d) }
                    : {})}
                />
              </li>
            );
          })}
      </ol>

      {sortedTombstoned.length > 0 && (
        <div className="drafts-panel__footer">
          <button
            type="button"
            className="drafts-panel__footer-btn"
            onClick={() => setShowDiscarded((v) => !v)}
          >
            {showDiscarded
              ? "hide discarded drafts"
              : `show ${sortedTombstoned.length} discarded draft${sortedTombstoned.length === 1 ? "" : "s"}`}
          </button>
          {showDiscarded && (
            <ol className="drafts-panel__list drafts-panel__list--discarded">
              {sortedTombstoned.map((d) => (
                <li key={d.id}>
                  <DraftEntry
                    draft={d}
                    state="tombstoned"
                    busy={busy}
                    dateLabel={relativeTime(d.createdAt)}
                    absoluteDate={absoluteTime(d.createdAt)}
                    onRecover={() => onRecover(d)}
                  />
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const delta = Date.now() - then;
  if (delta < 60_000) return "just now";
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}

function absoluteTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleString();
}

function divergenceMessage(div: {
  modified: string[];
  added: string[];
  missing: string[];
}): string {
  const changed = [...div.modified, ...div.added, ...div.missing];
  const count = changed.length;
  if (count === 0) return "";
  const sample = changed.slice(0, 3).join(", ");
  const more = count > 3 ? ` and ${count - 3} more` : "";
  return `You've edited ${count} file${count === 1 ? "" : "s"} by hand since this draft (${sample}${more}). Save those first or revert to continue.`;
}
