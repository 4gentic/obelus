import {
  type AssetResolver,
  blockExternalAssets,
  rewriteRelativeAssets,
} from "@obelus/source-render/browser";
import { type JSX, type Ref, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import "./host-frame.css";
import { sanitizeHtml } from "./sanitize";

export type HtmlMode = "source" | "html";

export interface HtmlViewProps {
  file: string;
  html: string;
  mode: HtmlMode;
  sourceFile?: string;
  assets?: AssetResolver;
  // When true, the iframe's CSP <meta> is omitted and external network
  // requests are no longer blocked. Toggled per-paper after the user
  // explicitly grants trust.
  trusted?: boolean;
  // Fired once the iframe has loaded and its `contentDocument.body` is
  // reachable. The adapter uses it to re-snapshot mount refs and refresh
  // the highlight overlay.
  onMountReady?: () => void;
  // Fired for every CSP violation reported inside the iframe. The host
  // surface accumulates the URIs and surfaces a "trust this paper?"
  // prompt when count > 0. Has no effect when `trusted` is true (the
  // CSP isn't installed, so violations cannot fire).
  onExternalBlocked?: (event: HtmlExternalBlocked) => void;
  ref?: Ref<HtmlViewHandle>;
}

export interface HtmlExternalBlocked {
  // The URL that would have loaded over the network. Surfaced verbatim
  // for the trust banner's host list.
  uri: string;
  // Informational tag identifying the gating layer. Today the only
  // emitter is the pre-render rewrite (`"blocked-pre-render"`); a future
  // network-API shim would push e.g. `"blocked-fetch"` here.
  directive: string;
}

export interface HtmlViewHandle {
  // The wrapper element (the React-rendered host). Selection capture and
  // bounding-box queries from the adapter target this node.
  getHost(): HTMLDivElement | null;
  // The body element of the iframe document that owns the rendered content.
  // Anchor resolvers look up `data-html-file` on this node. When the iframe
  // hasn't loaded yet, returns null.
  //
  // Historical note: this used to live inside a shadow root, hence the
  // `getShadowMount` name. We render in a sandboxed iframe today — WebKit
  // (Tauri on macOS) didn't reliably expose in-shadow selection to
  // `document.getSelection()`, but `iframe.contentWindow.getSelection()`
  // works. The contract here is mount-strategy-agnostic; the name is kept
  // to avoid churning every call site.
  getShadowMount(): HTMLElement | null;
  // The iframe element itself, exposed so the adapter can compute its
  // viewport-relative offset for translating overlay rects into the
  // parent document's coordinate space.
  getFrame(): HTMLIFrameElement | null;
}

// Preserves the offline-first invariant for any author script that survived
// sanitization. `connect-src 'none'` blocks fetch/XHR/WebSocket/EventSource;
// network-loading directives (img-src, font-src, etc.) accept only the
// iframe's own origin and the blob:/data: URLs that the asset resolver
// produces from the local bundle. `'unsafe-inline'` is required because
// authored CSS and JS are inline by definition.
const CSP_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline' blob: data:",
  "style-src 'unsafe-inline' blob: data:",
  "img-src 'self' blob: data:",
  "font-src blob: data:",
  "media-src blob: data:",
  "connect-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

// Defensive: keep author CSS from prematurely closing our outer `<style>`
// wrapper if it ever contains a `</style>` substring. The browser is
// case-insensitive when scanning for the closing tag, so the escape has
// to match the same way.
function escapeStyleClose(css: string): string {
  return css.replace(/<\/style/gi, "<\\/style");
}

function buildSrcdoc(
  headHtml: string,
  bodyHtml: string,
  authorStyles: ReadonlyArray<string>,
  trusted: boolean,
): string {
  const authorBlocks = authorStyles
    .map((css) => `<style>${escapeStyleClose(css)}</style>`)
    .join("");
  // When the user has trusted this paper, omit the CSP <meta> entirely.
  // The iframe sandbox still applies, but external resources (images,
  // scripts, stylesheets, fonts hosted on remote servers) can load and
  // scripts can connect out. Trust is the user's call; the CSP is the
  // restricted-mode default.
  const cspMeta = trusted
    ? ""
    : `<meta http-equiv="Content-Security-Policy" content="${CSP_POLICY}" />`;
  return (
    "<!doctype html><html><head>" +
    '<meta charset="utf-8" />' +
    '<meta name="viewport" content="width=device-width, initial-scale=1" />' +
    cspMeta +
    headHtml +
    authorBlocks +
    "</head><body>" +
    bodyHtml +
    "</body></html>"
  );
}

export function HtmlView({
  file,
  html,
  mode,
  sourceFile,
  assets,
  trusted = false,
  onMountReady,
  onExternalBlocked,
  ref,
}: HtmlViewProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const mountRef = useRef<HTMLElement | null>(null);
  const onMountReadyRef = useRef(onMountReady);
  onMountReadyRef.current = onMountReady;
  const onExternalBlockedRef = useRef(onExternalBlocked);
  onExternalBlockedRef.current = onExternalBlocked;

  const sanitized = useMemo(() => sanitizeHtml(html), [html]);

  useImperativeHandle(
    ref,
    () => ({
      getHost: () => hostRef.current,
      getShadowMount: () => mountRef.current,
      getFrame: () => frameRef.current,
    }),
    [],
  );

  // Re-paint sanitized HTML whenever input or file changes. The mount lives
  // inside a sandboxed `srcdoc` iframe so author `<style>` blocks (including
  // `:root`/`html`/`body` selectors) apply within the iframe's own cascade
  // without leaking into Obelus chrome. `allow-scripts allow-same-origin`
  // lets author JS run while the parent reads `iframe.contentDocument` for
  // selection capture; the no-runtime-network invariant is held by the CSP
  // <meta> we inject ahead of any author content.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const doc = host.ownerDocument;
    if (!doc) return;

    let frame = frameRef.current;
    if (frame === null) {
      frame = doc.createElement("iframe");
      frame.className = "html-view__iframe";
      frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
      frame.setAttribute("title", "HTML paper preview");
      host.appendChild(frame);
      frameRef.current = frame;
    }

    let cancelled = false;
    const onLoad = (): void => {
      if (cancelled) return;
      const innerDoc = frame?.contentDocument;
      const body = innerDoc?.body;
      if (!innerDoc || !body) {
        console.info("[html-view] iframe load fired without contentDocument", { file });
        return;
      }
      body.setAttribute("data-html-file", file);
      if (mode === "source" && sourceFile !== undefined) {
        body.setAttribute("data-html-mode", "source");
        body.setAttribute("data-source-file", sourceFile);
      } else {
        body.setAttribute("data-html-mode", "html");
        body.removeAttribute("data-source-file");
      }
      mountRef.current = body;
      onMountReadyRef.current?.();
    };

    frame.addEventListener("load", onLoad);

    // Pre-rewrite all URL-bearing tags in the sanitized HTML before the
    // iframe parses srcdoc:
    //   1. Relative paths → blob: URLs from the asset resolver (figs/x.png,
    //      ./styles.css, …) so they actually load — srcdoc has no base URL.
    //   2. External (http/https) URLs → `data:,` placeholders when the
    //      paper isn't trusted, with the originals stashed on
    //      `data-blocked-src` and surfaced via `onExternalBlocked` for the
    //      trust banner. We can't depend on the iframe's CSP <meta> for
    //      detection: the `securitypolicyviolation` listener can't be
    //      attached before parse, and WebKit (Tauri) doesn't reliably
    //      enforce CSP via <meta> in srcdoc iframes anyway.
    const setSrcdoc = async (): Promise<void> => {
      let headHtml = sanitized.headHtml;
      let bodyHtml = sanitized.bodyHtml;
      if (assets) {
        const tempDoc = new DOMParser().parseFromString(
          `<!doctype html><html><head>${headHtml}</head><body>${bodyHtml}</body></html>`,
          "text/html",
        );
        await rewriteRelativeAssets(tempDoc.documentElement, assets);
        headHtml = tempDoc.head.innerHTML;
        bodyHtml = tempDoc.body.innerHTML;
      }
      if (!trusted) {
        const headBlocked = blockExternalAssets(headHtml, "head");
        const bodyBlocked = blockExternalAssets(bodyHtml, "body");
        headHtml = headBlocked.html;
        bodyHtml = bodyBlocked.html;
        const cb = onExternalBlockedRef.current;
        if (cb) {
          for (const uri of headBlocked.blocked) cb({ uri, directive: "blocked-pre-render" });
          for (const uri of bodyBlocked.blocked) cb({ uri, directive: "blocked-pre-render" });
          for (const uri of sanitized.authorStylesBlocked)
            cb({ uri, directive: "blocked-pre-render" });
        }
      }
      if (cancelled || !frame) return;
      frame.srcdoc = buildSrcdoc(headHtml, bodyHtml, sanitized.authorStyles, trusted);
    };

    void setSrcdoc();

    return () => {
      cancelled = true;
      frame?.removeEventListener("load", onLoad);
    };
  }, [sanitized, file, mode, sourceFile, assets, trusted]);

  return (
    <div
      ref={hostRef}
      className="html-view"
      data-html-file={file}
      data-html-script-count={sanitized.scriptCount}
      data-html-link-count={sanitized.linkCount}
    />
  );
}
