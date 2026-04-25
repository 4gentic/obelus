import {
  type AssetResolver,
  blockExternalAssets,
  type RenderError,
  renderMarkdown,
  rewriteRelativeAssets,
} from "@obelus/source-render/browser";
import { type JSX, type Ref, useEffect, useImperativeHandle, useMemo, useRef } from "react";

export type MarkdownRenderStatus = { kind: "ok" } | { kind: "parse-failed"; error: RenderError };

export interface MarkdownExternalBlocked {
  // Original URL the renderer emitted (e.g., `https://example.com/x.png`).
  uri: string;
}

export interface MarkdownViewProps {
  file: string;
  text: string;
  onRender?: (status: MarkdownRenderStatus) => void;
  // Resolves relative `<img src>` / `<a href>` paths to blob URLs. Optional;
  // omitting it preserves the renderer's raw paths (useful in tests).
  assets?: AssetResolver;
  // When true, external `<img>` / `<source>` URLs are passed through and
  // the browser fetches them normally. When false (the default), they're
  // swapped to a 1×1 placeholder data URL before the rendered HTML
  // reaches the DOM, and `onExternalBlocked` fires once per blocked URL.
  trusted?: boolean;
  onExternalBlocked?: (event: MarkdownExternalBlocked) => void;
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
  trusted = false,
  onExternalBlocked,
  ref,
}: MarkdownViewProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onExternalBlockedRef = useRef(onExternalBlocked);
  onExternalBlockedRef.current = onExternalBlocked;
  // Read `onRender` through a ref so an inline `onRender={…}` from the parent
  // doesn't drag the notification effect into a render loop. The effect should
  // fire only when the render result itself changes.
  const onRenderRef = useRef(onRender);
  onRenderRef.current = onRender;

  useImperativeHandle(ref, () => ({ getContainer: () => containerRef.current }), []);

  const render = useMemo(() => renderMarkdown({ file, text }), [file, text]);

  useEffect(() => {
    onRenderRef.current?.(
      render.ok ? { kind: "ok" } : { kind: "parse-failed", error: render.error },
    );
  }, [render]);

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
  // External `<img>` / `<source>` URLs are swapped to a placeholder before
  // the string reaches the DOM (otherwise the browser starts fetching as
  // soon as innerHTML is set, and a post-render fix-up arrives too late).
  const html = render.ok ? render.html : null;
  const gated = useMemo<{ html: string; blocked: ReadonlyArray<string> } | null>(() => {
    if (html === null) return null;
    if (trusted) return { html, blocked: [] };
    return blockExternalAssets(html);
  }, [html, trusted]);
  const innerHtmlProp: ReturnType<typeof innerHtmlFromRenderer> | undefined = useMemo(
    () => (gated === null ? undefined : innerHtmlFromRenderer(gated.html)),
    [gated],
  );

  // Notify the host surface about each blocked URL on the render that
  // produced it. Listed deps are intentional: `gated` re-fires on every
  // render that produces a different `html`/`trusted` pair, which is
  // when the blocked set is recomputed.
  useEffect(() => {
    if (!gated || gated.blocked.length === 0) return;
    const cb = onExternalBlockedRef.current;
    if (!cb) return;
    for (const uri of gated.blocked) cb({ uri });
  }, [gated]);

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
