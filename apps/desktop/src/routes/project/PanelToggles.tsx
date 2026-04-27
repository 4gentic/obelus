import type { JSX } from "react";

interface Props {
  showFilesToggle: boolean;
  filesHidden: boolean;
  reviewHidden: boolean;
  onToggleFiles: () => void;
  onToggleReview: () => void;
}

export default function PanelToggles({
  showFilesToggle,
  filesHidden,
  reviewHidden,
  onToggleFiles,
  onToggleReview,
}: Props): JSX.Element {
  const filesVisible = !filesHidden;
  const reviewVisible = !reviewHidden;
  return (
    <div className="panel-toggles">
      {showFilesToggle ? (
        <button
          type="button"
          className="panel-toggles__btn"
          onClick={onToggleFiles}
          aria-pressed={filesVisible}
          aria-label={filesVisible ? "Hide files panel" : "Show files panel"}
          title={filesVisible ? "Hide files (⌘B)" : "Show files (⌘B)"}
        >
          <PanelLeftIcon active={filesVisible} />
        </button>
      ) : null}
      <button
        type="button"
        className="panel-toggles__btn"
        onClick={onToggleReview}
        aria-pressed={reviewVisible}
        aria-label={reviewVisible ? "Hide review panel" : "Show review panel"}
        title={reviewVisible ? "Hide review (⌘\\)" : "Show review (⌘\\)"}
      >
        <PanelRightIcon active={reviewVisible} />
      </button>
    </div>
  );
}

function PanelLeftIcon({ active }: { active: boolean }): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="3.25" width="12" height="9.5" rx="1.25" />
      <line x1="6.25" y1="3.25" x2="6.25" y2="12.75" />
      {active ? (
        <rect
          x="2.6"
          y="3.85"
          width="3.05"
          height="8.3"
          rx="0.6"
          fill="currentColor"
          stroke="none"
        />
      ) : null}
    </svg>
  );
}

function PanelRightIcon({ active }: { active: boolean }): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="3.25" width="12" height="9.5" rx="1.25" />
      <line x1="9.75" y1="3.25" x2="9.75" y2="12.75" />
      {active ? (
        <rect
          x="10.35"
          y="3.85"
          width="3.05"
          height="8.3"
          rx="0.6"
          fill="currentColor"
          stroke="none"
        />
      ) : null}
    </svg>
  );
}
