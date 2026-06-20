import { type ClassifyResult, classifyHtml, useHtmlDocumentView } from "@obelus/html-view";
import type { DocumentView } from "@obelus/review-shell";
import type { JSX } from "react";
import { useEffect, useMemo } from "react";
import { bannerFor, ReviewBody, type ReviewContentProps, useSurfaceTrust } from "./ReviewBody";
import { useOpfsAssetResolver } from "./use-opfs-asset-resolver";

// classifyHtml stays inside this lazy module so @obelus/html-view never lands
// in the PDF/Markdown chunks. The result is reported up so the parent's export
// flows can point the bundle entrypoint at a paired source file; until then
// (the brief window before this module mounts) exports fall back to html mode.
export default function HtmlReviewContent(
  props: ReviewContentProps & {
    state: Extract<ReviewContentProps["state"], { kind: "ready-html" }>;
    onClassified: (result: ClassifyResult) => void;
  },
): JSX.Element {
  const { onClassified, ...rest } = props;
  const { state } = rest;
  const classified = useMemo<ClassifyResult>(
    () => classifyHtml({ html: state.html, siblingPaths: [], file: state.file }),
    [state.html, state.file],
  );
  useEffect(() => {
    onClassified(classified);
  }, [classified, onClassified]);

  const trust = useSurfaceTrust(state.paper.id);
  const assets = useOpfsAssetResolver();
  const documentView = useHtmlDocumentView({
    file: state.file,
    html: state.html,
    mode: classified.mode,
    ...(classified.mode === "source" ? { sourceFile: classified.sourceFile } : {}),
    assets,
    annotations: rest.annotations,
    selectedAnchor: rest.selectedAnchor,
    draftCategory: rest.draftCategory,
    focusedId: rest.focusedAnnotationId,
    onAnchor: rest.onAnchor,
    trusted: trust.trusted,
    onExternalBlocked: (event) => trust.onBlocked(event.uri),
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
  return <ReviewBody {...rest} documentView={wrapped} />;
}
