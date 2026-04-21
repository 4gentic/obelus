import { type JSX, useEffect, useRef, useState } from "react";
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
  xhigh: "xhigh",
  max: "max",
};

function shortModel(resolved: string | null): string {
  if (!resolved) return "—";
  if (resolved === "opus" || resolved === "sonnet" || resolved === "haiku") return resolved;
  if (resolved.includes("opus")) return "opus";
  if (resolved.includes("sonnet")) return "sonnet";
  if (resolved.includes("haiku")) return "haiku";
  return resolved;
}

export default function ClaudeChip(): JSX.Element {
  const cfg = useClaudeConfig();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent): void {
      const el = wrapperRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const modelText = shortModel(cfg.resolvedModel);
  const effortText = cfg.resolvedEffort ?? "—";
  const modelInherited = cfg.model === null;
  const effortInherited = cfg.effort === null;

  return (
    <div className="claude-chip-wrap" ref={wrapperRef}>
      <button
        type="button"
        className={`claude-chip${open ? " claude-chip--open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={
          modelInherited && effortInherited
            ? "Following Claude Code defaults. Click to override."
            : "Click to change model or effort."
        }
      >
        <span className="claude-chip__value">{modelText}</span>
        <span className="claude-chip__sep">·</span>
        <span className="claude-chip__value">{effortText}</span>
        <span className="claude-chip__caret" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className="claude-chip-pop" role="dialog" aria-label="Claude model and effort">
          <div className="claude-chip-pop__group">
            <div className="claude-chip-pop__label">Model</div>
            <ul className="claude-chip-pop__options">
              <li>
                <button
                  type="button"
                  className={`claude-chip-pop__opt${cfg.model === null ? " claude-chip-pop__opt--on" : ""}`}
                  onClick={() => void cfg.setModel(null)}
                >
                  Follow Claude Code
                  {cfg.defaults?.model ? (
                    <span className="claude-chip-pop__hint"> · {cfg.defaults.model}</span>
                  ) : null}
                </button>
              </li>
              {MODEL_CHOICES.map((m) => (
                <li key={m}>
                  <button
                    type="button"
                    className={`claude-chip-pop__opt${cfg.model === m ? " claude-chip-pop__opt--on" : ""}`}
                    onClick={() => void cfg.setModel(m)}
                  >
                    {MODEL_LABEL[m]}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="claude-chip-pop__group">
            <div className="claude-chip-pop__label">Effort</div>
            <ul className="claude-chip-pop__options">
              <li>
                <button
                  type="button"
                  className={`claude-chip-pop__opt${cfg.effort === null ? " claude-chip-pop__opt--on" : ""}`}
                  onClick={() => void cfg.setEffort(null)}
                >
                  Follow Claude Code
                  {cfg.defaults?.effortLevel ? (
                    <span className="claude-chip-pop__hint"> · {cfg.defaults.effortLevel}</span>
                  ) : null}
                </button>
              </li>
              {EFFORT_CHOICES.map((e) => (
                <li key={e}>
                  <button
                    type="button"
                    className={`claude-chip-pop__opt${cfg.effort === e ? " claude-chip-pop__opt--on" : ""}`}
                    onClick={() => void cfg.setEffort(e)}
                  >
                    {EFFORT_LABEL[e]}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <p className="claude-chip-pop__foot">Changes apply to the next run.</p>
        </div>
      )}
    </div>
  );
}
