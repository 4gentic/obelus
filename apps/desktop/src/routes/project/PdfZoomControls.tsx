import type { JSX } from "react";
import {
  bumpPdfZoom,
  PDF_ZOOM_BASE,
  PDF_ZOOM_MAX,
  PDF_ZOOM_MIN,
  setPdfTool,
  setPdfZoom,
  usePanCapable,
  usePdfAutoScale,
  usePdfTool,
  usePdfZoom,
} from "./pdf-zoom-store";

interface Props {
  paperId: string;
}

export default function PdfZoomControls({ paperId }: Props): JSX.Element {
  const override = usePdfZoom(paperId);
  const autoScale = usePdfAutoScale(paperId);
  const tool = usePdfTool(paperId);
  const panCapable = usePanCapable(paperId);
  const effective = override ?? autoScale ?? PDF_ZOOM_BASE;
  const percent = Math.round((effective / PDF_ZOOM_BASE) * 100);
  const atMin = effective <= PDF_ZOOM_MIN + 0.001;
  const atMax = effective >= PDF_ZOOM_MAX - 0.001;
  const isAuto = override === null;
  const panOn = tool === "pan";

  return (
    <div className="pdf-zoom">
      <button
        type="button"
        className="btn btn--subtle pdf-zoom__btn"
        onClick={() => bumpPdfZoom(paperId, -1)}
        disabled={atMin}
        aria-label="Zoom out"
        title="Zoom out (⌘−)"
      >
        −
      </button>
      <button
        type="button"
        className="btn btn--subtle pdf-zoom__pct"
        onClick={() => setPdfZoom(paperId, null)}
        title={isAuto ? "Auto-fit (⌘0)" : "Reset to auto-fit (⌘0)"}
        aria-label="Zoom level; click to reset"
      >
        {isAuto ? "Auto" : `${percent}%`}
      </button>
      <button
        type="button"
        className="btn btn--subtle pdf-zoom__btn"
        onClick={() => bumpPdfZoom(paperId, 1)}
        disabled={atMax}
        aria-label="Zoom in"
        title="Zoom in (⌘+)"
      >
        +
      </button>
      {panCapable && (
        <button
          type="button"
          className="btn btn--subtle pdf-zoom__btn pdf-zoom__btn--tool"
          onClick={() => setPdfTool(paperId, panOn ? "select" : "pan")}
          aria-pressed={panOn}
          aria-label={panOn ? "Switch to select tool" : "Switch to pan tool"}
          title={panOn ? "Select tool" : "Pan tool (or hold Space)"}
        >
          <HandIcon />
        </button>
      )}
    </div>
  );
}

function HandIcon(): JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 8.5V3.5a1 1 0 0 1 2 0V8" />
      <path d="M7 8V2.5a1 1 0 0 1 2 0V8" />
      <path d="M9 8V3a1 1 0 0 1 2 0v5.5" />
      <path d="M11 7a1 1 0 0 1 2 0v4.5a3.5 3.5 0 0 1-3.5 3.5h-2A4.5 4.5 0 0 1 3 10.5V8a1 1 0 0 1 2 0" />
    </svg>
  );
}
