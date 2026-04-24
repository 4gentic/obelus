import type { JSX, KeyboardEvent, PointerEvent, RefObject } from "react";
import { useCallback, useRef } from "react";
import {
  clampPaneWidth,
  type DividerSide,
  MIN_MARGIN_WIDTH,
  MIN_REVIEW_WIDTH,
} from "./layout-store";

interface PaneDividerProps {
  side: DividerSide;
  bodyRef: RefObject<HTMLDivElement | null>;
  hideLeft: boolean;
  valueNow: number | undefined;
  onChange: (value: number, otherWidth: number) => void;
}

interface DragStart {
  pointerX: number;
  startWidth: number;
  bodyWidth: number;
  filesWidth: number;
  otherWidth: number;
}

type BaseMeasure = Omit<DragStart, "pointerX">;

function measure(body: HTMLDivElement, side: DividerSide, hideLeft: boolean): BaseMeasure | null {
  const cols = getComputedStyle(body).gridTemplateColumns.split(" ").map(Number.parseFloat);
  const expected = hideLeft ? 3 : 4;
  if (cols.length < expected || cols.some((n) => Number.isNaN(n))) return null;
  const filesWidth = hideLeft ? 0 : (cols[0] ?? 0);
  const marginWidth = hideLeft ? (cols[1] ?? 0) : (cols[2] ?? 0);
  const reviewWidth = hideLeft ? (cols[2] ?? 0) : (cols[3] ?? 0);
  const bodyWidth = body.getBoundingClientRect().width;
  return {
    startWidth: side === "margin" ? marginWidth : reviewWidth,
    otherWidth: side === "margin" ? reviewWidth : marginWidth,
    bodyWidth,
    filesWidth,
  };
}

export default function PaneDivider({
  side,
  bodyRef,
  hideLeft,
  valueNow,
  onChange,
}: PaneDividerProps): JSX.Element {
  const startRef = useRef<DragStart | null>(null);

  const onPointerDown = useCallback(
    (ev: PointerEvent<HTMLDivElement>) => {
      if (ev.button !== 0) return;
      const body = bodyRef.current;
      if (!body) return;
      const base = measure(body, side, hideLeft);
      if (!base) return;
      startRef.current = { pointerX: ev.clientX, ...base };
      ev.currentTarget.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    },
    [bodyRef, side, hideLeft],
  );

  const onPointerMove = useCallback(
    (ev: PointerEvent<HTMLDivElement>) => {
      const s = startRef.current;
      if (!s) return;
      const desired = s.startWidth - (ev.clientX - s.pointerX);
      onChange(
        clampPaneWidth({
          side,
          desired,
          bodyWidth: s.bodyWidth,
          filesWidth: s.filesWidth,
          otherWidth: s.otherWidth,
        }),
        s.otherWidth,
      );
    },
    [side, onChange],
  );

  const endDrag = useCallback((ev: PointerEvent<HTMLDivElement>) => {
    startRef.current = null;
    if (ev.currentTarget.hasPointerCapture(ev.pointerId)) {
      ev.currentTarget.releasePointerCapture(ev.pointerId);
    }
  }, []);

  const onKeyDown = useCallback(
    (ev: KeyboardEvent<HTMLDivElement>) => {
      if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
      const body = bodyRef.current;
      if (!body) return;
      const base = measure(body, side, hideLeft);
      if (!base) return;
      const step = (ev.shiftKey ? 32 : 8) * (ev.key === "ArrowLeft" ? 1 : -1);
      onChange(
        clampPaneWidth({
          side,
          desired: base.startWidth + step,
          bodyWidth: base.bodyWidth,
          filesWidth: base.filesWidth,
          otherWidth: base.otherWidth,
        }),
        base.otherWidth,
      );
      ev.preventDefault();
    },
    [bodyRef, side, hideLeft, onChange],
  );

  return (
    // biome-ignore lint/a11y/useSemanticElements: <hr> cannot be focused or host keyboard handlers
    <div
      className={`project-shell__divider project-shell__divider--${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={side === "margin" ? "Resize margin column" : "Resize review column"}
      aria-valuemin={side === "margin" ? MIN_MARGIN_WIDTH : MIN_REVIEW_WIDTH}
      aria-valuenow={valueNow}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
    />
  );
}
