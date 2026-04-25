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

// Grows with content up to its 240px max via CSS; we reset scrollHeight on
// every change so the textarea matches the text, no layout shift at steady state.
function resize(el: HTMLTextAreaElement): void {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
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
