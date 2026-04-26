import type { PaperRow } from "@obelus/repo";
import { ask } from "@tauri-apps/plugin-dialog";
import { type CSSProperties, type JSX, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { exportPaperToFile } from "../../lib/paper-export";
import { resetPaper as resetPaperOp } from "../../lib/paper-reset";
import { useProject } from "./context";

interface PopPosition {
  top: number;
  right: number;
  minWidth: number;
}

function computePopPosition(trigger: HTMLElement): PopPosition {
  const rect = trigger.getBoundingClientRect();
  const POP_WIDTH = 220;
  const margin = 8;
  const top = Math.min(window.innerHeight - margin, rect.bottom + 4);
  const right = Math.max(margin, window.innerWidth - rect.right);
  return { top, right, minWidth: POP_WIDTH };
}

export interface PaperActionsMenuProps {
  paper: PaperRow;
}

export default function PaperActionsMenu({ paper }: PaperActionsMenuProps): JSX.Element {
  const { project, repo, rootId, openFilePath, setOpenFilePath } = useProject();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<PopPosition | null>(null);

  const reposition = useCallback(() => {
    if (triggerRef.current) setPos(computePopPosition(triggerRef.current));
  }, []);

  useEffect(() => {
    if (!open) return;
    reposition();
    function onClick(e: MouseEvent): void {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (wrapperRef.current?.contains(target)) return;
      if (popRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setOpen(false);
    }
    function onScrollOrResize(): void {
      reposition();
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open, reposition]);

  const onExport = useCallback(async () => {
    setOpen(false);
    setBusy(true);
    try {
      const { savedTo } = await exportPaperToFile({
        repo,
        paperId: paper.id,
        format: paper.format,
        rootId,
      });
      if (savedTo !== null) console.info("[paper-export]", { paperId: paper.id, savedTo });
    } catch (err) {
      console.warn("PaperActionsMenu: export failed", paper.id, err);
      await ask(err instanceof Error ? err.message : "Could not export this paper.", {
        title: "Export failed",
        kind: "error",
        okLabel: "OK",
      });
    } finally {
      setBusy(false);
    }
  }, [repo, rootId, paper.id, paper.format]);

  const onReset = useCallback(async () => {
    setOpen(false);
    const ok = await ask(
      `This permanently erases every annotation, review, write-up, and apply history for "${paper.title}". The file on disk is untouched. This cannot be undone.\n\nTip: cancel and choose Export… first if you want a backup.`,
      {
        title: "Reset paper",
        kind: "warning",
        okLabel: "Reset paper",
        cancelLabel: "Cancel",
      },
    );
    if (!ok) return;
    setBusy(true);
    // Clear the open file before deleting — once the paper row is gone, any
    // mounted review surface would be reading a stale paperId.
    if (paper.pdfRelPath && openFilePath === paper.pdfRelPath) setOpenFilePath(null);
    try {
      await resetPaperOp({ repo, paperId: paper.id, projectId: project.id });
    } catch (err) {
      console.warn("PaperActionsMenu: reset failed", paper.id, err);
      await ask(err instanceof Error ? err.message : "Could not reset this paper.", {
        title: "Reset failed",
        kind: "error",
        okLabel: "OK",
      });
    } finally {
      setBusy(false);
    }
  }, [repo, project.id, paper.id, paper.title, paper.pdfRelPath, openFilePath, setOpenFilePath]);

  const popStyle: CSSProperties =
    pos === null
      ? { visibility: "hidden", pointerEvents: "none" }
      : { top: pos.top, right: pos.right, minWidth: pos.minWidth };

  return (
    <div className="paper-actions-wrap" ref={wrapperRef}>
      <button
        type="button"
        ref={triggerRef}
        className={`paper-actions-trigger${open ? " paper-actions-trigger--open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Paper actions"
        title="Paper actions"
        disabled={busy}
      >
        <span aria-hidden="true">⋮</span>
      </button>
      {open
        ? createPortal(
            <div
              className="paper-actions-pop"
              role="menu"
              aria-label="Paper actions"
              ref={popRef}
              style={popStyle}
            >
              <button
                type="button"
                role="menuitem"
                className="paper-actions-pop__item"
                onClick={() => void onExport()}
              >
                Export…
                <span className="paper-actions-pop__hint">Save a JSON backup</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="paper-actions-pop__item paper-actions-pop__item--danger"
                onClick={() => void onReset()}
              >
                Reset…
                <span className="paper-actions-pop__hint">Erase reviews and annotations</span>
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
