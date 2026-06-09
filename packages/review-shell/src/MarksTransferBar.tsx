import type { JSX } from "react";
import MarksImportPrompt from "./MarksImportPrompt";
import "./MarksTransferBar.css";

type Props = {
  onExport: () => void;
  onImport: () => void;
  exportDisabled: boolean;
  status: { message: string | null; error: boolean };
  // When an import lands on a paper that already has marks, the caller hands the
  // replace-vs-merge choice down here; the prompt stands in for the status line
  // until the reviewer decides. Data and handlers travel together so the prompt
  // can never render without the means to resolve it.
  pendingImport?: {
    incoming: number;
    existing: number;
    onReplace: () => void;
    onMerge: () => void;
    onCancel: () => void;
  } | null;
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
  pendingImport,
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
      {pendingImport ? (
        <MarksImportPrompt
          incoming={pendingImport.incoming}
          existing={pendingImport.existing}
          onReplace={pendingImport.onReplace}
          onMerge={pendingImport.onMerge}
          onCancel={pendingImport.onCancel}
        />
      ) : status.message ? (
        <p className="marks-transfer__status" data-error={status.error ? "true" : undefined}>
          {status.message}
        </p>
      ) : null}
    </fieldset>
  );
}
