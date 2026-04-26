import {
  type AssetResolver,
  type ClassifyResult,
  type HtmlExternalBlocked,
  useHtmlDocumentView,
} from "@obelus/html-view";
import "@obelus/html-view/host-frame.css";
import { TrustBanner } from "@obelus/review-shell";
import "@obelus/review-shell/review-shell.css";
import { type JSX, useCallback, useEffect, useState } from "react";
import "./html-review-surface.css";
import { useFindStore } from "./find-store-context";
import { useReviewStore } from "./store-context";

interface Props {
  path: string;
  html: string;
  classification: ClassifyResult;
  // Resolver for relative `<img>` / `<source>` / `<a>` URLs in the rendered
  // HTML. Desktop callers pass a `useAssetResolver`-built resolver backed by
  // Tauri IPC; without it, relative assets render as broken icons but text
  // selection and anchoring still work.
  assets?: AssetResolver;
  // Per-paper trust toggle — when true, the iframe's CSP is dropped and
  // external resources load. Wired by `OpenPaper` from `app-state.json`.
  trusted: boolean;
  onTrust?: () => void;
}

export default function HtmlReviewSurface({
  path,
  html,
  classification,
  assets,
  trusted,
  onTrust,
}: Props): JSX.Element {
  const store = useReviewStore();
  const annotations = store((s) => s.annotations);
  const selectedAnchor = store((s) => s.selectedAnchor);
  const draftCategory = store((s) => s.draftCategory);
  const focusedId = store((s) => s.focusedAnnotationId);
  const setSelectedAnchor = store((s) => s.setSelectedAnchor);
  const [blockedUris, setBlockedUris] = useState<ReadonlyArray<string>>([]);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const onExternalBlocked = useCallback((event: HtmlExternalBlocked) => {
    setBlockedUris((prev) => (prev.includes(event.uri) ? prev : [...prev, event.uri]));
  }, []);

  const documentView = useHtmlDocumentView({
    file: path,
    html,
    mode: classification.mode,
    trusted,
    ...(classification.mode === "source" ? { sourceFile: classification.sourceFile } : {}),
    ...(assets !== undefined ? { assets } : {}),
    onExternalBlocked,
    annotations,
    selectedAnchor,
    draftCategory,
    focusedId,
    onAnchor: (draft) => setSelectedAnchor(draft),
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

  const showBanner =
    !trusted && !bannerDismissed && blockedUris.length > 0 && onTrust !== undefined;
  const hosts = uniqueHosts(blockedUris);

  return (
    <div className="html-pane">
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
      // Non-URL violation IDs (rare with our `inline`/`eval` filter in
      // HtmlView) are dropped quietly — they're not network-egress.
    }
  }
  return Array.from(out);
}
