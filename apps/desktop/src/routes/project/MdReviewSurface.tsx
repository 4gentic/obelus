import { type MarkdownExternalBlocked, useMdDocumentView } from "@obelus/md-view";
import "@obelus/md-view/md.css";
import { TrustBanner } from "@obelus/review-shell";
import "@obelus/review-shell/review-shell.css";
import { type JSX, useCallback, useEffect, useRef, useState } from "react";
import "./md-review-surface.css";
import { useRegisterDocumentScroll } from "./document-scroll-context";
import { findScrollAncestor } from "./find-scroll-ancestor";
import { useFindStore } from "./find-store-context";
import { useReviewStore } from "./store-context";
import { useVerifyOnSave } from "./use-verify-on-save";

interface Props {
  path: string;
  text: string;
  // Per-paper trust toggle — when true, external `<img>` / `<source>` URLs
  // are passed through to the browser. Wired by `OpenPaper` from
  // `app-state.json`.
  trusted: boolean;
  onTrust?: () => void;
}

export default function MdReviewSurface({ path, text, trusted, onTrust }: Props): JSX.Element {
  const store = useReviewStore();
  const annotations = store((s) => s.annotations);
  const selectedAnchor = store((s) => s.selectedAnchor);
  const draftCategory = store((s) => s.draftCategory);
  const focusedId = store((s) => s.focusedAnnotationId);
  const setSelectedAnchor = store((s) => s.setSelectedAnchor);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [blockedUris, setBlockedUris] = useState<ReadonlyArray<string>>([]);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useVerifyOnSave(path);

  const onExternalBlocked = useCallback((event: MarkdownExternalBlocked) => {
    setBlockedUris((prev) => (prev.includes(event.uri) ? prev : [...prev, event.uri]));
  }, []);

  const documentView = useMdDocumentView({
    file: path,
    text,
    annotations,
    selectedAnchor,
    draftCategory,
    focusedId,
    onAnchor: (draft) => setSelectedAnchor(draft),
    onRenderError: setRenderError,
    trusted,
    onExternalBlocked,
  });

  const findStore = useFindStore();
  const findProvider = documentView.find;
  useEffect(() => {
    if (!findProvider) return;
    findStore.getState().setProvider(findProvider);
    return () => {
      findStore.getState().setProvider(null);
    };
  }, [findProvider, findStore]);

  const paneRef = useRef<HTMLDivElement | null>(null);
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const el = paneRef.current;
    setScrollEl(el ? findScrollAncestor(el) : null);
  }, []);
  useRegisterDocumentScroll(scrollEl, documentView.annotationTops, documentView.scrollToAnnotation);

  const showBanner =
    !trusted && !bannerDismissed && blockedUris.length > 0 && onTrust !== undefined;
  const hosts = uniqueHosts(blockedUris);

  return (
    <div className="md-pane" ref={paneRef}>
      {renderError !== null ? (
        <p className="md-pane__render-error" role="alert">
          Markdown render failed: {renderError}
        </p>
      ) : null}
      {showBanner ? (
        <TrustBanner
          hosts={hosts}
          blockedCount={blockedUris.length}
          onTrust={onTrust}
          onDismiss={() => setBannerDismissed(true)}
        />
      ) : null}
      {documentView.content}
    </div>
  );
}

function uniqueHosts(uris: ReadonlyArray<string>): string[] {
  const out = new Set<string>();
  for (const uri of uris) {
    try {
      out.add(new URL(uri).host);
    } catch {
      // Bare paths / fragments slip through here and are ignored.
    }
  }
  return Array.from(out);
}
