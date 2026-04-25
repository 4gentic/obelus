import {
  type AssetResolver,
  type RenderError,
  renderMarkdown,
  rewriteRelativeAssets,
} from "@obelus/source-render/browser";
import { type JSX, type Ref, useEffect, useImperativeHandle, useMemo, useRef } from "react";

export type MarkdownRenderStatus = { kind: "ok" } | { kind: "parse-failed"; error: RenderError };

export interface MarkdownViewProps {
  file: string;
  text: string;
  onRender?: (status: MarkdownRenderStatus) => void;
  // Resolves relative `<img src>` / `<a href>` paths to blob URLs. Optional;
  // omitting it preserves the renderer's raw paths (useful in tests).
  assets?: AssetResolver;
  ref?: Ref<MarkdownViewHandle>;
}

export interface MarkdownViewHandle {
  getContainer(): HTMLDivElement | null;
}

export function MarkdownView({
  file,
  text,
  onRender,
  assets,
  ref,
}: MarkdownViewProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useImperativeHandle(ref, () => ({ getContainer: () => containerRef.current }), []);

  const render = useMemo(() => renderMarkdown({ file, text }), [file, text]);

  useEffect(() => {
    if (!onRender) return;
    onRender(render.ok ? { kind: "ok" } : { kind: "parse-failed", error: render.error });
  }, [render, onRender]);

  // After each render, rewrite relative asset paths to resolver-supplied URLs.
  // Without this hook, `<img src="figs/x.png">` falls back to the document's
  // base URL — which under our offline guarantees never resolves to anything
  // and quietly breaks figures. The resolver is the caller's bridge into
  // OPFS / Tauri FS reads.
  useEffect(() => {
    if (!assets) return;
    if (!render.ok) return;
    const container = containerRef.current;
    if (!container) return;
    void rewriteRelativeAssets(container, assets);
  }, [render, assets]);

  // Stable prop reference when the rendered HTML is unchanged — React's
  // reconciler then skips re-applying the inner-HTML setter, which would
  // otherwise rewrite the div's children and detach text nodes mid-drag.
  const html = render.ok ? render.html : null;
  const innerHtmlProp: ReturnType<typeof innerHtmlFromRenderer> | undefined = useMemo(
    () => (html === null ? undefined : innerHtmlFromRenderer(html)),
    [html],
  );

  if (!render.ok) {
    return (
      <div
        ref={containerRef}
        className="md-view md-view--error"
        data-md-view-root={file}
        role="alert"
      >
        <p>Could not render this markdown document.</p>
      </div>
    );
  }

  return <div ref={containerRef} className="md-view" data-md-view-root={file} {...innerHtmlProp} />;
}

// `renderMarkdown` calls toHast WITHOUT allowDangerousHtml: raw HTML in the
// source is dropped at parse time and the serialized output is safe. We wrap
// the React prop behind a helper so the project-wide audit trail has a single
// place to reason about the invariant.
function innerHtmlFromRenderer(html: string): { dangerouslySetInnerHTML: { __html: string } } {
  return { dangerouslySetInnerHTML: { __html: html } };
}
