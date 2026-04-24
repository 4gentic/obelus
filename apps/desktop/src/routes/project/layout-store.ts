import { useCallback, useSyncExternalStore } from "react";

export const MIN_CENTER_WIDTH = 400;
export const MIN_MARGIN_WIDTH = 180;
export const MIN_REVIEW_WIDTH = 320;

export interface PaneWidths {
  marginWidth: number;
  reviewWidth: number;
}

export type DividerSide = "margin" | "review";

interface ClampContext {
  side: DividerSide;
  desired: number;
  bodyWidth: number;
  filesWidth: number;
  otherWidth: number;
}

export function clampPaneWidth(ctx: ClampContext): number {
  const min = ctx.side === "margin" ? MIN_MARGIN_WIDTH : MIN_REVIEW_WIDTH;
  const max = ctx.bodyWidth - ctx.filesWidth - MIN_CENTER_WIDTH - ctx.otherWidth;
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

function setPaneWidth(projectId: string, side: DividerSide, value: number): void {
  const prev = widthsByProject.get(projectId);
  const next: PaneWidths = {
    marginWidth: side === "margin" ? value : (prev?.marginWidth ?? value),
    reviewWidth: side === "review" ? value : (prev?.reviewWidth ?? value),
  };
  widthsByProject.set(projectId, next);
  notify(projectId);
}

export interface ProjectLayout {
  widths: PaneWidths | null;
  setWidth: (side: DividerSide, value: number) => void;
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
    (side: DividerSide, value: number) => {
      setPaneWidth(projectId, side, value);
    },
    [projectId],
  );
  return { widths, setWidth };
}
