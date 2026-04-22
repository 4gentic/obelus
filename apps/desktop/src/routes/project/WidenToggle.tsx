import type { JSX } from "react";

interface Props {
  wide: boolean;
  onToggle: () => void;
}

export default function WidenToggle({ wide, onToggle }: Props): JSX.Element {
  return (
    <button
      type="button"
      className="widen-toggle"
      onClick={onToggle}
      aria-pressed={wide}
      aria-label={wide ? "Restore review pane width" : "Widen review pane"}
      title={wide ? "Restore width" : "Widen"}
    >
      <WidenIcon expanded={wide} />
      <span className="widen-toggle__label">{wide ? "Narrow" : "Widen"}</span>
    </button>
  );
}

function WidenIcon({ expanded }: { expanded: boolean }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="8" y1="2" x2="8" y2="14" />
      {expanded ? (
        <>
          <polyline points="12,4 10,8 12,12" />
          <line x1="10" y1="8" x2="14" y2="8" />
          <polyline points="4,4 6,8 4,12" />
          <line x1="2" y1="8" x2="6" y2="8" />
        </>
      ) : (
        <>
          <polyline points="10,4 12,8 10,12" />
          <line x1="14" y1="8" x2="10" y2="8" />
          <polyline points="6,4 4,8 6,12" />
          <line x1="2" y1="8" x2="6" y2="8" />
        </>
      )}
    </svg>
  );
}
