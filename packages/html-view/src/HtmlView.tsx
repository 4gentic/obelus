import { type AssetResolver, rewriteRelativeAssets } from "@obelus/source-render/browser";
import { type JSX, type Ref, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { sanitizeHtml } from "./sanitize";
import { SHADOW_SHIM_CSS } from "./shadow-shim";

export type HtmlMode = "source" | "html";

export interface HtmlViewProps {
  file: string;
  html: string;
  mode: HtmlMode;
  sourceFile?: string;
  assets?: AssetResolver;
  ref?: Ref<HtmlViewHandle>;
}

export interface HtmlViewHandle {
  // The host element in the light DOM. Selection capture and bounding-box
  // queries from the adapter target this node.
  getHost(): HTMLDivElement | null;
  // The element inside the shadow root that owns the rendered content.
  // Anchor resolvers look up `data-html-file` on this node.
  getShadowMount(): HTMLDivElement | null;
}

// Mount sanitized HTML into a target element by parsing through DOMParser
// and importing the resulting nodes. The bytes were already routed through
// DOMPurify (sanitize.ts) before reaching us; this helper exists so the
// shadow-root paint path doesn't reach for innerHTML directly.
function paintSanitized(target: HTMLElement, sanitizedHtml: string): void {
  while (target.firstChild) target.removeChild(target.firstChild);
  const parsed = new DOMParser().parseFromString(sanitizedHtml, "text/html");
  const doc = target.ownerDocument;
  for (const node of Array.from(parsed.body.childNodes)) {
    target.appendChild(doc.importNode(node, true));
  }
}

export function HtmlView({
  file,
  html,
  mode,
  sourceFile,
  assets,
  ref,
}: HtmlViewProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const shadowRootRef = useRef<ShadowRoot | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);

  const sanitized = useMemo(() => sanitizeHtml(html), [html]);

  useImperativeHandle(
    ref,
    () => ({
      getHost: () => hostRef.current,
      getShadowMount: () => mountRef.current,
    }),
    [],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (shadowRootRef.current === null) {
      const root = host.attachShadow({ mode: "closed" });
      const style = host.ownerDocument.createElement("style");
      style.textContent = SHADOW_SHIM_CSS;
      const mount = host.ownerDocument.createElement("div");
      mount.setAttribute("data-html-file", file);
      mount.className = "html-view__mount";
      root.appendChild(style);
      root.appendChild(mount);
      shadowRootRef.current = root;
      mountRef.current = mount;
    }
  }, [file]);

  // Re-paint sanitized HTML whenever input or file changes. The shadow root is
  // attached once per host element; the inner mount's children are replaced
  // on each update so detached ranges don't pin orphan nodes.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    mount.setAttribute("data-html-file", file);
    if (mode === "source" && sourceFile !== undefined) {
      mount.setAttribute("data-html-mode", "source");
      mount.setAttribute("data-source-file", sourceFile);
    } else {
      mount.setAttribute("data-html-mode", "html");
      mount.removeAttribute("data-source-file");
    }
    paintSanitized(mount, sanitized.html);
    if (assets) {
      void rewriteRelativeAssets(mount, assets);
    }
  }, [sanitized.html, file, mode, sourceFile, assets]);

  return (
    <div
      ref={hostRef}
      className="html-view"
      data-html-file={file}
      data-html-dropped-scripts={sanitized.droppedScripts}
    />
  );
}
