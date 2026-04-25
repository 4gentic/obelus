import { type ClassifyResult, useHtmlDocumentView } from "@obelus/html-view";
import "@obelus/html-view/shadow-shim.css";
import "@obelus/review-shell/review-shell.css";
import type { JSX } from "react";
import "./html-review-surface.css";
import { useReviewStore } from "./store-context";

interface Props {
  path: string;
  html: string;
  classification: ClassifyResult;
}

// Thin DocumentView adapter for HTML papers — mirrors `MdReviewSurface`.
// Mounts the html preview (Shadow DOM + DOMPurify) and routes selection into
// the shared review store. The composer, marks list, and export live in the
// right column.
export default function HtmlReviewSurface({ path, html, classification }: Props): JSX.Element {
  const store = useReviewStore();
  const annotations = store((s) => s.annotations);
  const selectedAnchor = store((s) => s.selectedAnchor);
  const draftCategory = store((s) => s.draftCategory);
  const focusedId = store((s) => s.focusedAnnotationId);
  const setSelectedAnchor = store((s) => s.setSelectedAnchor);

  const documentView = useHtmlDocumentView({
    file: path,
    html,
    mode: classification.mode,
    ...(classification.mode === "source" ? { sourceFile: classification.sourceFile } : {}),
    annotations,
    selectedAnchor,
    draftCategory,
    focusedId,
    onAnchor: (draft) => setSelectedAnchor(draft),
  });

  return <div className="html-pane">{documentView.content}</div>;
}
