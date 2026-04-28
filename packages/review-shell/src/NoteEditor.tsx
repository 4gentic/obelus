import { useEffect, useRef } from "react";
import "./NoteEditor.css";

import type { JSX } from "react";

type Props = {
  value: string;
  onChange: (next: string) => void;
  onCommit: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
};

// Auto-grows with content; preserves any height the user has dragged to.
function resize(el: HTMLTextAreaElement): void {
  const current = el.offsetHeight;
  el.style.height = "auto";
  const natural = el.scrollHeight;
  el.style.height = `${Math.max(current, Math.min(natural, 480))}px`;
}

export default function NoteEditor({
  value,
  onChange,
  onCommit,
  placeholder,
  disabled = false,
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
      className="note-editor__ta"
      value={value}
      placeholder={placeholder ?? "Write a note…"}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => onCommit(e.target.value)}
      disabled={disabled}
    />
  );
}
