import type { JSX, KeyboardEvent, PointerEvent, RefObject } from "react";
import { useCallback, useRef } from "react";
import {
  clampPaneWidth,
  type DividerSide,
  MIN_FILES_WIDTH,
  MIN_MARGIN_WIDTH,
  MIN_REVIEW_WIDTH,
  type PaneWidths,
} from "./layout-store";

interface PaneDividerProps {
  side: DividerSide;
  bodyRef: RefObject<HTMLDivElement | null>;
  hideLeft: boolean;
  valueNow: number | undefined;
  onChange: (value: number, measured: PaneWidths) => void;
}

interface DragStart {
  pointerX: number;
  startWidth: number;
  bodyWidth: number;
  otherFixedWidth: number;
  measured: PaneWidths;
}

type BaseMeasure = Omit<DragStart, "pointerX">;

const MIN_BY_SIDE: Record<DividerSide, number> = {
  files: MIN_FILES_WIDTH,
  margin: MIN_MARGIN_WIDTH,
  review: MIN_REVIEW_WIDTH,
};

const LABEL_BY_SIDE: Record<DividerSide, string> = {
  files: "Resize files column",
  margin: "Resize margin column",
  review: "Resize review column",
};

function measure(body: HTMLDivElement, side: DividerSide, hideLeft: boolean): BaseMeasure | null {
  const cols = getComputedStyle(body).gridTemplateColumns.split(" ").map(Number.parseFloat);
  const expected = hideLeft ? 3 : 4;
  if (cols.length < expected || cols.some((n) => Number.isNaN(n))) return null;
  const filesWidth = hideLeft ? 0 : (cols[0] ?? 0);
  const marginWidth = hideLeft ? (cols[1] ?? 0) : (cols[2] ?? 0);
  const reviewWidth = hideLeft ? (cols[2] ?? 0) : (cols[3] ?? 0);
  const bodyWidth = body.getBoundingClientRect().width;
  const startWidth = side === "files" ? filesWidth : side === "margin" ? marginWidth : reviewWidth;
  const otherFixedWidth =
    side === "files"
      ? marginWidth + reviewWidth
      : side === "margin"
        ? filesWidth + reviewWidth
        : filesWidth + marginWidth;
  return {
    startWidth,
    otherFixedWidth,
    bodyWidth,
    measured: { filesWidth, marginWidth, reviewWidth },
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
      // Files is anchored on the left: rightward drag widens it. Margin and
      // review are anchored on the right: rightward drag narrows them.
      const delta = ev.clientX - s.pointerX;
      const desired = side === "files" ? s.startWidth + delta : s.startWidth - delta;
      onChange(
        clampPaneWidth({
          side,
          desired,
          bodyWidth: s.bodyWidth,
          otherFixedWidth: s.otherFixedWidth,
        }),
        s.measured,
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
      // ArrowLeft moves the divider left → files shrinks, margin/review grow.
      // ArrowRight is the opposite.
      const magnitude = (ev.shiftKey ? 32 : 8) * (ev.key === "ArrowLeft" ? -1 : 1);
      const signed = side === "files" ? magnitude : -magnitude;
      onChange(
        clampPaneWidth({
          side,
          desired: base.startWidth + signed,
          bodyWidth: base.bodyWidth,
          otherFixedWidth: base.otherFixedWidth,
        }),
        base.measured,
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
      aria-label={LABEL_BY_SIDE[side]}
      aria-valuemin={MIN_BY_SIDE[side]}
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
