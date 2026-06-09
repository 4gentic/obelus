import type { JSX } from "react";
import "./MarksTransferBar.css";

type Props = {
  onExport: () => void;
  onImport: () => void;
  exportDisabled: boolean;
  status: { message: string | null; error: boolean };
};

// The colophon for the Marks panel: a quiet mono footer that carries the
// portable-marks transfer actions, set off from the marks by a hairline rule so
// it reads as document chrome rather than two more marks. Shared verbatim by the
// web ReviewPane and the desktop ReviewList — one style, both surfaces.
export default function MarksTransferBar({
  onExport,
  onImport,
  exportDisabled,
  status,
}: Props): JSX.Element {
  return (
    <fieldset className="marks-transfer" aria-label="Transfer marks">
      <div className="marks-transfer__actions">
        <button
          type="button"
          className="marks-transfer__action"
          onClick={onExport}
          disabled={exportDisabled}
          title="Export your marks as a portable .json file"
        >
          <span className="marks-transfer__glyph" aria-hidden="true">
            ↧
          </span>
          Export
        </button>
        <button
          type="button"
          className="marks-transfer__action"
          onClick={onImport}
          title="Import marks from a .json file onto this paper"
        >
          <span className="marks-transfer__glyph" aria-hidden="true">
            ↥
          </span>
          Import
        </button>
      </div>
      {status.message ? (
        <p className="marks-transfer__status" data-error={status.error ? "true" : undefined}>
          {status.message}
        </p>
      ) : null}
    </fieldset>
  );
}
