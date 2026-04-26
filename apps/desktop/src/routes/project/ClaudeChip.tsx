import { type CSSProperties, type JSX, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  type ClaudeEffortChoice,
  type ClaudeModelChoice,
  EFFORT_CHOICES,
  MODEL_CHOICES,
  useClaudeConfig,
} from "../../lib/use-claude-defaults";

const MODEL_LABEL: Record<Exclude<ClaudeModelChoice, null>, string> = {
  opus: "Opus 4.7",
  sonnet: "Sonnet 4.6",
  haiku: "Haiku 4.5",
};

const EFFORT_LABEL: Record<Exclude<ClaudeEffortChoice, null>, string> = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "x-high",
  max: "max",
};

const DEFAULT_LABEL = "default";

function shortModel(resolved: string | null): string | null {
  if (!resolved) return null;
  if (resolved === "opus" || resolved === "sonnet" || resolved === "haiku") return resolved;
  if (resolved.includes("opus")) return "opus";
  if (resolved.includes("sonnet")) return "sonnet";
  if (resolved.includes("haiku")) return "haiku";
  return resolved;
}

function effortShort(value: string | null): string | null {
  if (!value) return null;
  if (value === "xhigh") return "x-high";
  return value;
}

interface PopPosition {
  top: number;
  left: number;
  minWidth: number;
}

function computePopPosition(trigger: HTMLElement): PopPosition {
  const rect = trigger.getBoundingClientRect();
  const POP_WIDTH = 280;
  const margin = 8;
  const top = Math.min(window.innerHeight - margin, rect.bottom + 4);
  const rawLeft = rect.right - POP_WIDTH;
  const clampedLeft = Math.max(margin, Math.min(window.innerWidth - POP_WIDTH - margin, rawLeft));
  return { top, left: clampedLeft, minWidth: POP_WIDTH };
}

export default function ClaudeChip(): JSX.Element {
  const cfg = useClaudeConfig();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<PopPosition | null>(null);

  const reposition = useCallback(() => {
    if (triggerRef.current) setPos(computePopPosition(triggerRef.current));
  }, []);

  useEffect(() => {
    if (!open) return;
    reposition();
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
    function onScrollOrResize(): void {
      reposition();
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open, reposition]);

  const modelInherited = cfg.model === null;
  const effortInherited = cfg.effort === null;
  const modelText = shortModel(cfg.resolvedModel) ?? DEFAULT_LABEL;
  const effortText = effortShort(cfg.resolvedEffort) ?? DEFAULT_LABEL;
  const allInherited = modelInherited && effortInherited;

  const title = (() => {
    if (!cfg.loaded) return "Loading Claude defaults…";
    if (allInherited) return "Following Claude Code defaults. Click to override model or effort.";
    return "Click to change model or effort. Changes apply to the next run.";
  })();

  const popStyle: CSSProperties =
    pos === null
      ? { visibility: "hidden", pointerEvents: "none" }
      : { top: pos.top, left: pos.left, minWidth: pos.minWidth };

  return (
    <div className="claude-chip-wrap" ref={wrapperRef}>
      <button
        type="button"
        ref={triggerRef}
        className={`claude-chip${open ? " claude-chip--open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={title}
      >
        <span className="claude-chip__brand">claude</span>
        <span className="claude-chip__sep" aria-hidden>
          ·
        </span>
        <span
          className={`claude-chip__value${modelInherited ? " claude-chip__value--inherited" : ""}`}
        >
          {modelText}
        </span>
        <span className="claude-chip__sep" aria-hidden>
          ·
        </span>
        <span
          className={`claude-chip__value${effortInherited ? " claude-chip__value--inherited" : ""}`}
        >
          {effortText}
        </span>
        <span className="claude-chip__caret" aria-hidden>
          ▾
        </span>
      </button>
      {open
        ? createPortal(
            <div
              className="claude-chip-pop"
              role="dialog"
              aria-label="Claude model and effort"
              ref={popRef}
              style={popStyle}
            >
              <div className="claude-chip-pop__group">
                <div className="claude-chip-pop__row">
                  <span className="claude-chip-pop__label">Model</span>
                  <span className="claude-chip-pop__hint">
                    {modelInherited
                      ? `inherited · ${cfg.defaults?.model ?? "Claude Code default"}`
                      : "override"}
                  </span>
                </div>
                <div className="claude-chip-pop__seg">
                  <button
                    type="button"
                    className={`claude-chip-pop__seg-btn${modelInherited ? " claude-chip-pop__seg-btn--on" : ""}`}
                    onClick={() => void cfg.setModel(null)}
                  >
                    {DEFAULT_LABEL}
                  </button>
                  {MODEL_CHOICES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`claude-chip-pop__seg-btn${cfg.model === m ? " claude-chip-pop__seg-btn--on" : ""}`}
                      onClick={() => void cfg.setModel(m)}
                      title={MODEL_LABEL[m]}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div className="claude-chip-pop__group">
                <div className="claude-chip-pop__row">
                  <span className="claude-chip-pop__label">Effort</span>
                  <span className="claude-chip-pop__hint">
                    {effortInherited
                      ? `inherited · ${cfg.defaults?.effortLevel ?? "Claude Code default"}`
                      : "override"}
                  </span>
                </div>
                <div className="claude-chip-pop__seg">
                  <button
                    type="button"
                    className={`claude-chip-pop__seg-btn${effortInherited ? " claude-chip-pop__seg-btn--on" : ""}`}
                    onClick={() => void cfg.setEffort(null)}
                  >
                    {DEFAULT_LABEL}
                  </button>
                  {EFFORT_CHOICES.map((e) => (
                    <button
                      key={e}
                      type="button"
                      className={`claude-chip-pop__seg-btn${cfg.effort === e ? " claude-chip-pop__seg-btn--on" : ""}`}
                      onClick={() => void cfg.setEffort(e)}
                    >
                      {EFFORT_LABEL[e]}
                    </button>
                  ))}
                </div>
              </div>
              <p className="claude-chip-pop__foot">Applies to the next run.</p>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
