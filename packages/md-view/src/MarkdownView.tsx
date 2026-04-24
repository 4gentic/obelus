import { renderMarkdown, type RenderError } from "@obelus/source-render/browser";
import {
  type ForwardedRef,
  forwardRef,
  type JSX,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";

export type MarkdownRenderStatus =
  | { kind: "ok" }
  | { kind: "parse-failed"; error: RenderError };

export interface MarkdownViewProps {
  file: string;
  text: string;
  onRender?: (status: MarkdownRenderStatus) => void;
}

export interface MarkdownViewHandle {
  getContainer(): HTMLDivElement | null;
}

function Component(
  { file, text, onRender }: MarkdownViewProps,
  ref: ForwardedRef<MarkdownViewHandle>,
): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useImperativeHandle(ref, () => ({ getContainer: () => containerRef.current }), []);

  const render = useMemo(() => renderMarkdown({ file, text }), [file, text]);

  useEffect(() => {
    if (!onRender) return;
    onRender(render.ok ? { kind: "ok" } : { kind: "parse-failed", error: render.error });
  }, [render, onRender]);

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

  return (
    <div
      ref={containerRef}
      className="md-view"
      data-md-view-root={file}
      {...innerHtmlFromRenderer(render.html)}
    />
  );
}

// `renderMarkdown` calls toHast WITHOUT allowDangerousHtml: raw HTML in the
// source is dropped at parse time and the serialized output is safe. We wrap
// the React prop behind a helper so the project-wide audit trail has a single
// place to reason about the invariant.
function innerHtmlFromRenderer(html: string): { dangerouslySetInnerHTML: { __html: string } } {
  return { dangerouslySetInnerHTML: { __html: html } };
}

export const MarkdownView = forwardRef<MarkdownViewHandle, MarkdownViewProps>(Component);
