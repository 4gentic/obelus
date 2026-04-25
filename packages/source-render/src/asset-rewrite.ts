// Resolves a relative path (as seen in src/href) to a usable URL — typically a
// `blob:` URL backed by an OPFS read or a Tauri FS read. Returning null marks
// the asset as missing; the rewrite walk records it for boundary logging.
export interface AssetResolver {
  resolve(relPath: string): Promise<string | null>;
}

const ABSOLUTE_OR_NON_FILE = /^(?:[a-z]+:|\/\/|#|data:|blob:)/i;
const ABSOLUTE_NETWORK = /^https?:\/\//i;

const REWRITE_TARGETS: ReadonlyArray<{ tag: string; attr: string }> = [
  { tag: "img", attr: "src" },
  { tag: "source", attr: "src" },
  { tag: "a", attr: "href" },
  // Stylesheet and script sources need pre-load rewriting: the iframe's
  // srcdoc has no base URL, so a relative href/src would otherwise fail
  // to load before any post-load fix-up could re-point it. Absolute URLs
  // stay untouched here and are blocked by the iframe CSP at runtime.
  { tag: "link", attr: "href" },
  { tag: "script", attr: "src" },
];

// Tags whose URL attribute auto-loads (no user gesture). `<a href>` is
// click navigation, not a passive fetch, and is left intact so trust-
// blocked papers still have working in-document links. The set covers
// both the markdown path (`<img>` / `<source>` from rendered prose) and
// the html-iframe path (author-provided `<link rel=stylesheet>` and
// `<script src>` in the document head).
const BLOCK_TARGETS: ReadonlyArray<{ tag: string; attr: string }> = [
  { tag: "img", attr: "src" },
  { tag: "source", attr: "src" },
  { tag: "link", attr: "href" },
  { tag: "script", attr: "src" },
];

function isRelative(value: string): boolean {
  if (value === "") return false;
  return !ABSOLUTE_OR_NON_FILE.test(value);
}

// Synchronously rewrites external `<img>` / `<source>` / `<link>` / `<script>`
// URLs in a rendered HTML fragment to a placeholder data URL, returning the
// gated string and the original URLs that were blocked. Used by MarkdownView
// (which has no iframe / CSP) and by HtmlView (where WebKit's CSP-via-meta
// support in srcdoc iframes is unreliable, so the rewrite is the actual
// enforcement) to honour the offline default before the browser parses the
// HTML and starts fetching. The opt-out is the host surface's per-paper
// trust state — see `apps/desktop/src/store/app-state.ts` and
// `apps/web/src/store/trusted-papers.ts`.
//
// The HTML5 parser relocates head-only tags (`<link>`, `<script>`) into
// `<head>` even when they appear in body context, which breaks round-trip
// serialization unless we parse the fragment in the slot it actually
// belongs to. The `slot` parameter selects the wrapper so head fragments
// (the iframe srcdoc's `<head>` content) and body fragments (markdown
// output, the iframe srcdoc's `<body>` content) keep their structure.
export function blockExternalAssets(
  html: string,
  slot: "head" | "body" = "body",
): { html: string; blocked: string[] } {
  const parsed = new DOMParser().parseFromString(
    slot === "head"
      ? `<!doctype html><html><head>${html}</head></html>`
      : `<!doctype html><html><body>${html}</body></html>`,
    "text/html",
  );
  const root = slot === "head" ? parsed.head : parsed.body;
  const blocked: string[] = [];
  for (const { tag, attr } of BLOCK_TARGETS) {
    for (const el of Array.from(root.querySelectorAll(tag))) {
      const value = el.getAttribute(attr);
      if (value === null) continue;
      if (!ABSOLUTE_NETWORK.test(value)) continue;
      blocked.push(value);
      el.setAttribute("data-blocked-src", value);
      el.setAttribute(attr, "data:,");
    }
  }
  return { html: root.innerHTML, blocked };
}

export async function rewriteRelativeAssets(
  root: Element,
  resolver: AssetResolver,
): Promise<{ rewritten: number; missing: string[] }> {
  const missing: string[] = [];
  let rewritten = 0;
  for (const { tag, attr } of REWRITE_TARGETS) {
    const elements = root.querySelectorAll(tag);
    for (const el of Array.from(elements)) {
      const value = el.getAttribute(attr);
      if (value === null) continue;
      if (!isRelative(value)) continue;
      const resolved = await resolver.resolve(value);
      if (resolved === null) {
        missing.push(value);
        continue;
      }
      el.setAttribute(attr, resolved);
      rewritten += 1;
    }
  }
  console.info("[asset-rewrite]", { rewritten, missing });
  return { rewritten, missing };
}
