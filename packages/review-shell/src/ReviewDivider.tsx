import type { JSX, KeyboardEvent, PointerEvent, RefObject } from "react";
import { useCallback, useRef } from "react";

export const MIN_DOC_WIDTH = 480;
export const MIN_PANE_WIDTH = 340;

interface Props {
  shellRef: RefObject<HTMLElement | null>;
  valueNow: number | undefined;
  onChange: (px: number) => void;
  onReset: () => void;
}

interface DragStart {
  pointerX: number;
  startPaneWidth: number;
  bodyWidth: number;
  gapWidth: number;
}

export function clampPaneWidth(desired: number, bodyWidth: number, gapWidth: number): number {
  const max = Math.max(MIN_PANE_WIDTH, bodyWidth - MIN_DOC_WIDTH - gapWidth);
  return Math.min(max, Math.max(MIN_PANE_WIDTH, desired));
}

interface Measurement {
  startPaneWidth: number;
  bodyWidth: number;
  gapWidth: number;
}

function measure(shell: HTMLElement): Measurement | null {
  const cols = getComputedStyle(shell).gridTemplateColumns.split(" ").map(Number.parseFloat);
  // Three tracks: doc | gap | pane. Drag adjusts the third.
  const gap = cols[1];
  const pane = cols[2];
  if (gap === undefined || pane === undefined || Number.isNaN(gap) || Number.isNaN(pane)) {
    return null;
  }
  return {
    startPaneWidth: pane,
    bodyWidth: shell.getBoundingClientRect().width,
    gapWidth: gap,
  };
}

export default function ReviewDivider({
  shellRef,
  valueNow,
  onChange,
  onReset,
}: Props): JSX.Element {
  const startRef = useRef<DragStart | null>(null);

  const onPointerDown = useCallback(
    (ev: PointerEvent<HTMLDivElement>) => {
      if (ev.button !== 0) return;
      const shell = shellRef.current;
      if (!shell) return;
      const base = measure(shell);
      if (!base) return;
      startRef.current = { pointerX: ev.clientX, ...base };
      ev.currentTarget.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    },
    [shellRef],
  );

  const onPointerMove = useCallback(
    (ev: PointerEvent<HTMLDivElement>) => {
      const s = startRef.current;
      if (!s) return;
      // Divider is left of the pane, so dragging right shrinks the pane.
      const desired = s.startPaneWidth - (ev.clientX - s.pointerX);
      onChange(clampPaneWidth(desired, s.bodyWidth, s.gapWidth));
    },
    [onChange],
  );

  const endDrag = useCallback((ev: PointerEvent<HTMLDivElement>) => {
    startRef.current = null;
    if (ev.currentTarget.hasPointerCapture(ev.pointerId)) {
      ev.currentTarget.releasePointerCapture(ev.pointerId);
    }
  }, []);

  const onKeyDown = useCallback(
    (ev: KeyboardEvent<HTMLDivElement>) => {
      const shell = shellRef.current;
      if (!shell) return;
      const base = measure(shell);
      if (!base) return;
      let desired: number | null = null;
      if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
        const step = (ev.shiftKey ? 32 : 8) * (ev.key === "ArrowRight" ? -1 : 1);
        desired = base.startPaneWidth + step;
      } else if (ev.key === "Home") {
        desired = base.bodyWidth - MIN_DOC_WIDTH - base.gapWidth;
      } else if (ev.key === "End") {
        desired = MIN_PANE_WIDTH;
      }
      if (desired === null) return;
      onChange(clampPaneWidth(desired, base.bodyWidth, base.gapWidth));
      ev.preventDefault();
    },
    [shellRef, onChange],
  );

  return (
    // biome-ignore lint/a11y/useSemanticElements: <hr> cannot be focused or host pointer / keyboard handlers
    <div
      className="review-shell__divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize review pane"
      aria-valuemin={MIN_PANE_WIDTH}
      aria-valuenow={valueNow}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
    />
  );
}
