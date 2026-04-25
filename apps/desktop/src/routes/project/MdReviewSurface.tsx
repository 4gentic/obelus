import { useMdDocumentView } from "@obelus/md-view";
import "@obelus/md-view/md.css";
import "@obelus/review-shell/review-shell.css";
import { type JSX, useState } from "react";
import "./md-review-surface.css";
import { useReviewStore } from "./store-context";
import { useVerifyOnSave } from "./use-verify-on-save";

interface Props {
  path: string;
  text: string;
}

// Thin DocumentView adapter for MD papers — mirrors `PdfPane`. Mounts the
// markdown preview + highlight overlay, routes the user's selection into the
// shared review store, and stops there. Composer, marks list, export, and
// lazy paper-creation all live in the right column now.
export default function MdReviewSurface({ path, text }: Props): JSX.Element {
  const store = useReviewStore();
  const annotations = store((s) => s.annotations);
  const selectedAnchor = store((s) => s.selectedAnchor);
  const draftCategory = store((s) => s.draftCategory);
  const focusedId = store((s) => s.focusedAnnotationId);
  const setSelectedAnchor = store((s) => s.setSelectedAnchor);
  const [renderError, setRenderError] = useState<string | null>(null);

  useVerifyOnSave(path);

  const documentView = useMdDocumentView({
    file: path,
    text,
    annotations,
    selectedAnchor,
    draftCategory,
    focusedId,
    onAnchor: (draft) => setSelectedAnchor(draft),
    onRenderError: setRenderError,
  });

  return (
    <div className="md-pane">
      {renderError !== null ? (
        <p className="md-pane__render-error" role="alert">
          Markdown render failed: {renderError}
        </p>
      ) : null}
      {documentView.content}
    </div>
  );
}
