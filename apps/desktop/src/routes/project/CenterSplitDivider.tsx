import type { JSX, KeyboardEvent, PointerEvent, RefObject } from "react";
import { useCallback, useRef } from "react";
import { clampSplitRatio } from "./source-split-store";

interface Props {
  // The `.center-split` grid; its width is the ratio's reference frame.
  containerRef: RefObject<HTMLDivElement | null>;
  valueNow: number;
  onChange: (ratio: number) => void;
}

export default function CenterSplitDivider({
  containerRef,
  valueNow,
  onChange,
}: Props): JSX.Element {
  const draggingRef = useRef(false);

  const onPointerDown = useCallback((ev: PointerEvent<HTMLDivElement>) => {
    if (ev.button !== 0) return;
    draggingRef.current = true;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  }, []);

  const onPointerMove = useCallback(
    (ev: PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width === 0) return;
      onChange(clampSplitRatio((ev.clientX - rect.left) / rect.width));
    },
    [containerRef, onChange],
  );

  const endDrag = useCallback((ev: PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    if (ev.currentTarget.hasPointerCapture(ev.pointerId)) {
      ev.currentTarget.releasePointerCapture(ev.pointerId);
    }
  }, []);

  const onKeyDown = useCallback(
    (ev: KeyboardEvent<HTMLDivElement>) => {
      if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
      const step = (ev.shiftKey ? 0.1 : 0.05) * (ev.key === "ArrowLeft" ? -1 : 1);
      onChange(clampSplitRatio(valueNow + step));
      ev.preventDefault();
    },
    [valueNow, onChange],
  );

  return (
    // biome-ignore lint/a11y/useSemanticElements: <hr> cannot be focused or host keyboard handlers
    <div
      className="center-split__divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize source and PDF panes"
      aria-valuemin={20}
      aria-valuemax={80}
      aria-valuenow={Math.round(valueNow * 100)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
    />
  );
}
