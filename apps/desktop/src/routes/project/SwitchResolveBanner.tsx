import type { JSX } from "react";

interface Props {
  from: string;
  to: string;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export default function SwitchResolveBanner({
  from,
  to,
  onSave,
  onDiscard,
  onCancel,
}: Props): JSX.Element {
  return (
    <div className="source-pane__switch-banner" role="alertdialog" aria-live="assertive">
      <p className="source-pane__switch-text">
        Unsaved changes in <code>{from}</code>. Switching to <code>{to}</code>.
      </p>
      <div className="source-pane__switch-actions">
        <button type="button" className="btn btn--subtle" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn--subtle" onClick={onDiscard}>
          Discard
        </button>
        <button type="button" className="btn btn--primary" onClick={onSave}>
          Save + switch
        </button>
      </div>
    </div>
  );
}
