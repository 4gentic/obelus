import { useCallback, useSyncExternalStore } from "react";

export const MIN_CENTER_WIDTH = 400;
export const MIN_FILES_WIDTH = 180;
export const MIN_MARGIN_WIDTH = 180;
export const MIN_REVIEW_WIDTH = 320;

export interface PaneWidths {
  filesWidth: number;
  marginWidth: number;
  reviewWidth: number;
}

export type DividerSide = "files" | "margin" | "review";

const MIN_BY_SIDE: Record<DividerSide, number> = {
  files: MIN_FILES_WIDTH,
  margin: MIN_MARGIN_WIDTH,
  review: MIN_REVIEW_WIDTH,
};

interface ClampContext {
  side: DividerSide;
  desired: number;
  bodyWidth: number;
  otherFixedWidth: number;
}

export function clampPaneWidth(ctx: ClampContext): number {
  const min = MIN_BY_SIDE[ctx.side];
  const max = ctx.bodyWidth - MIN_CENTER_WIDTH - ctx.otherFixedWidth;
  if (max < min) return min;
  if (ctx.desired < min) return min;
  if (ctx.desired > max) return max;
  return ctx.desired;
}

const widthsByProject = new Map<string, PaneWidths>();
const listenersByProject = new Map<string, Set<() => void>>();

function notify(projectId: string): void {
  const set = listenersByProject.get(projectId);
  if (!set) return;
  for (const cb of set) cb();
}

function setPaneWidth(
  projectId: string,
  side: DividerSide,
  value: number,
  measured: PaneWidths,
): void {
  const prev = widthsByProject.get(projectId);
  const next: PaneWidths = {
    filesWidth: side === "files" ? value : (prev?.filesWidth ?? measured.filesWidth),
    marginWidth: side === "margin" ? value : (prev?.marginWidth ?? measured.marginWidth),
    reviewWidth: side === "review" ? value : (prev?.reviewWidth ?? measured.reviewWidth),
  };
  widthsByProject.set(projectId, next);
  notify(projectId);
}

export interface ProjectLayout {
  widths: PaneWidths | null;
  setWidth: (side: DividerSide, value: number, measured: PaneWidths) => void;
}

export function useProjectLayout(projectId: string): ProjectLayout {
  const subscribe = useCallback(
    (cb: () => void) => {
      let set = listenersByProject.get(projectId);
      if (!set) {
        set = new Set();
        listenersByProject.set(projectId, set);
      }
      set.add(cb);
      return () => {
        set?.delete(cb);
      };
    },
    [projectId],
  );
  const getSnapshot = useCallback(() => widthsByProject.get(projectId) ?? null, [projectId]);
  const widths = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const setWidth = useCallback(
    (side: DividerSide, value: number, measured: PaneWidths) => {
      setPaneWidth(projectId, side, value, measured);
    },
    [projectId],
  );
  return { widths, setWidth };
}
