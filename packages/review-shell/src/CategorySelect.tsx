import { categoryMeta, DEFAULT_CATEGORIES } from "@obelus/categories";
import {
  type CSSProperties,
  type JSX,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import "./CategorySelect.css";

type Props = {
  value: string;
  onChange: (next: string) => void;
  ariaLabel?: string;
};

interface PopPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

const POP_WIDTH = 300;
const VIEWPORT_MARGIN = 16;
const TRIGGER_GAP = 4;

function computePopPosition(trigger: HTMLElement): PopPosition {
  const rect = trigger.getBoundingClientRect();
  const width = Math.min(POP_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
  const maxLeft = window.innerWidth - VIEWPORT_MARGIN - width;
  const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, maxLeft));

  // Flip above when the menu won't fit below — keeps every option visible
  // when the trigger sits near the bottom of a long marks list.
  const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN - TRIGGER_GAP;
  const spaceAbove = rect.top - VIEWPORT_MARGIN - TRIGGER_GAP;
  const placeBelow = spaceBelow >= spaceAbove;
  const maxHeight = Math.max(120, placeBelow ? spaceBelow : spaceAbove);
  const top = placeBelow
    ? rect.bottom + TRIGGER_GAP
    : Math.max(VIEWPORT_MARGIN, rect.top - TRIGGER_GAP - maxHeight);
  return { top, left, width, maxHeight };
}

export default function CategorySelect({ value, onChange, ariaLabel }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<PopPosition | null>(null);

  const current = categoryMeta(value);

  const reposition = useCallback(() => {
    if (triggerRef.current) setPos(computePopPosition(triggerRef.current));
  }, []);

  // Position synchronously before paint so the popover doesn't flash at the
  // viewport origin on first frame — matches PaperActionsMenu.
  useLayoutEffect(() => {
    if (!open) return;
    reposition();
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
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
    function onScroll(e: Event): void {
      const target = e.target;
      // The popover itself overflows when many options don't fit; ignore its
      // own internal scroll so the user can read the descriptions.
      if (target instanceof Node && popRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onResize(): void {
      setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const popStyle: CSSProperties =
    pos === null
      ? { visibility: "hidden", pointerEvents: "none" }
      : { top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight };

  return (
    <span className="cat-select" ref={wrapperRef}>
      <button
        type="button"
        ref={triggerRef}
        className="cat-select__trigger"
        data-cat={current.id}
        data-open={open ? "true" : "false"}
        style={{ ["--chip-accent" as string]: `var(${current.tokenVar})` }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="cat-select__trigger-label">{current.label}</span>
        <span className="cat-select__caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open
        ? createPortal(
            <div
              className="cat-select__pop"
              role="menu"
              aria-label="Choose category"
              ref={popRef}
              style={popStyle}
            >
              {DEFAULT_CATEGORIES.map((c) => {
                const checked = c.id === value;
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={checked}
                    className="cat-select__option"
                    data-checked={checked ? "true" : "false"}
                    style={{ ["--chip-accent" as string]: `var(${c.tokenVar})` }}
                    onClick={() => {
                      onChange(c.id);
                      setOpen(false);
                    }}
                  >
                    <span className="cat-select__option-label">{c.label}</span>
                    <span className="cat-select__option-hint">{c.description}</span>
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
