import { useMdDocumentView } from "@obelus/md-view";
import "@obelus/md-view/md.css";
import type { DocumentView } from "@obelus/review-shell";
import type { JSX } from "react";
import { useMemo } from "react";
import { bannerFor, ReviewBody, type ReviewContentProps, useSurfaceTrust } from "./ReviewBody";

export default function MdReviewContent(
  props: ReviewContentProps & {
    state: Extract<ReviewContentProps["state"], { kind: "ready-md" }>;
  },
): JSX.Element {
  const { state } = props;
  const trust = useSurfaceTrust(state.paper.id);
  const documentView = useMdDocumentView({
    file: state.file,
    text: state.text,
    annotations: props.annotations,
    selectedAnchor: props.selectedAnchor,
    draftCategory: props.draftCategory,
    focusedId: props.focusedAnnotationId,
    onAnchor: props.onAnchor,
    onRenderError: props.onRenderError,
    trusted: trust.trusted,
    onExternalBlocked: ({ uri }) => trust.onBlocked(uri),
  });
  const banner = bannerFor(trust);
  const wrapped = useMemo<DocumentView>(
    () =>
      banner === null
        ? documentView
        : {
            ...documentView,
            content: (
              <>
                {banner}
                {documentView.content}
              </>
            ),
          },
    [banner, documentView],
  );
  return <ReviewBody {...props} documentView={wrapped} />;
}
