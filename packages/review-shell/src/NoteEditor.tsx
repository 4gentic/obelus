import { useEffect, useRef } from "react";
import "./NoteEditor.css";

import type { JSX } from "react";

type Props = {
  value: string;
  onChange: (next: string) => void;
  onCommit?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
  tall?: boolean;
};

// Auto-grows with content up to a 10-line cap; preserves any height the user
// has dragged to. CSS keeps overflow hidden by default and JS toggles it on
// only when content exceeds the cap, so a normal short note doesn't render a
// stray scrollbar from sub-pixel scrollHeight/clientHeight rounding.
const MAX_VISIBLE_LINES = 10;

function resize(el: HTMLTextAreaElement): void {
  const styles = getComputedStyle(el);
  const lineHeight = Number.parseFloat(styles.lineHeight);
  const padTop = Number.parseFloat(styles.paddingTop);
  const padBottom = Number.parseFloat(styles.paddingBottom);
  const borderTop = Number.parseFloat(styles.borderTopWidth);
  const borderBottom = Number.parseFloat(styles.borderBottomWidth);
  const maxHeight = lineHeight * MAX_VISIBLE_LINES + padTop + padBottom + borderTop + borderBottom;

  const current = el.offsetHeight;
  el.style.height = "auto";
  const natural = el.scrollHeight + borderTop + borderBottom;
  el.style.height = `${Math.max(current, Math.min(natural, maxHeight))}px`;
  el.style.overflowY = natural > maxHeight ? "auto" : "hidden";
}

export default function NoteEditor({
  value,
  onChange,
  onCommit,
  placeholder,
  disabled = false,
  ariaLabel,
  id,
  tall = false,
}: Props): JSX.Element {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: ref.current is stable and the resize only needs to re-run on value change.
  useEffect(() => {
    const el = ref.current;
    if (el) resize(el);
  }, [value]);

  return (
    <textarea
      ref={ref}
      id={id}
      className={tall ? "note-editor__ta note-editor__ta--tall" : "note-editor__ta"}
      value={value}
      placeholder={placeholder ?? "Write a note…"}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit ? (e) => onCommit(e.target.value) : undefined}
      disabled={disabled}
      aria-label={ariaLabel}
    />
  );
}
