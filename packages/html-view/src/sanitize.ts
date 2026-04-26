import { scrubExternalCssUrls } from "@obelus/source-render/browser";
import createDOMPurify from "dompurify";

// Tags we explicitly add to DOMPurify's allow-list. `<script>` is *not*
// here on purpose: the iframe runs `sandbox="allow-scripts allow-same-origin"`
// so the parent can read `contentWindow.getSelection()` for selection
// capture, but that same-origin grant means any author script would inherit
// the embedder's origin and could call `parent.__TAURI_INTERNALS__.invoke`
// — full reach into the SQL/store/FS plugins listed in
// `apps/desktop/src-tauri/capabilities/main.json`. Letting DOMPurify strip
// `<script>` (and inline event handlers, and `javascript:` URIs, by default)
// removes that reach entirely while keeping the parent→iframe DOM access
// the review surface needs. `<link rel=stylesheet>` is the only surviving
// link rel — others (preconnect, dns-prefetch, preload, modulepreload, etc.)
// are pre-stripped before DOMPurify runs.
const ADD_TAGS: ReadonlyArray<string> = ["link"];

// Tags we forbid even if DOMPurify's defaults would allow them. <meta> is
// forbidden so author content can't override the CSP <meta http-equiv> the
// host frame injects. <base> is forbidden because a single
// `<base href="https://evil/">` re-points every relative URL in the
// document at parse time — it would undo the asset-rewrite layer
// (relative paths normally resolve through the resolver to local blobs).
// <iframe>/<object>/<embed> are dangerous; authors who need video can use
// <video>/<audio>.
const FORBID_TAGS: ReadonlyArray<string> = ["iframe", "object", "embed", "meta", "base"];

// Permits relative paths, http(s), blob:, data:, and in-document fragments.
// `javascript:` and other arbitrary schemes are rejected by the negative
// lookahead. Offline papers never need remote schemes beyond http(s); the
// asset rewriter typically replaces those with blob: URLs before mount, and
// the iframe CSP refuses external network loads regardless.
const ALLOWED_URI_REGEXP = /^(?:(?:[a-z]+:)?\/\/)?(?!javascript:)|^blob:|^data:|^#/i;

const LINK_REL_STYLESHEET = "stylesheet";

export interface SanitizeResult {
  // Sanitized <head> contents, with author <style> blocks removed (their
  // CSS is in `authorStyles`). Surviving <link rel=stylesheet> and <title>
  // elements appear here verbatim. Author <script> tags are stripped — see
  // the ADD_TAGS comment above for why.
  headHtml: string;
  // Sanitized <body> contents.
  bodyHtml: string;
  // CSS text from each author <style> block in the original document
  // (head and body, in that order). DOMPurify is intentionally bypassed
  // for these so values it doesn't recognize (`:root` custom properties,
  // complex selectors) survive intact; external `url(...)` references and
  // `@import`s are pre-scrubbed to `data:,` so the browser still never
  // starts the fetch. The originals are reported via `authorStylesBlocked`
  // so the trust banner can list them.
  authorStyles: ReadonlyArray<string>;
  // External URLs scrubbed out of author `<style>` blocks. Forwarded to
  // `onExternalBlocked` by the host so the trust banner counts them.
  authorStylesBlocked: ReadonlyArray<string>;
  // Boundary-log accounting (see CLAUDE.md "Tracing at ingest boundaries").
  // Dropped tag *names* (lowercased), not just a count — CLAUDE.md requires
  // identifiers so a reader of the log can reconstruct what was removed.
  scriptCount: number;
  linkCount: number;
  droppedTags: ReadonlyArray<string>;
  droppedDangerousLinks: ReadonlyArray<string>;
}

export function sanitizeHtml(input: string): SanitizeResult {
  // Parse first. DOMParser tolerates both fragments and full documents:
  // a fragment becomes <html><head/><body>{fragment}</body></html>, so the
  // same path handles both.
  const parsed = new DOMParser().parseFromString(input, "text/html");

  const authorStyles: string[] = [];
  const authorStylesBlocked: string[] = [];
  for (const root of [parsed.head, parsed.body]) {
    for (const styleEl of Array.from(root.querySelectorAll("style"))) {
      const scrubbed = scrubExternalCssUrls(styleEl.textContent ?? "");
      authorStyles.push(scrubbed.css);
      for (const uri of scrubbed.blocked) authorStylesBlocked.push(uri);
      styleEl.remove();
    }
  }

  // Pre-strip <link> elements whose rel is anything but "stylesheet".
  // preconnect/dns-prefetch/preload/modulepreload/etc. all imply network
  // egress, and icon/manifest/alternate fire silent fetches too. Done
  // before DOMPurify because mutating `allowedTags` from a per-element
  // hook would leak across sibling elements.
  const droppedDangerousLinks: string[] = [];
  for (const root of [parsed.head, parsed.body]) {
    for (const linkEl of Array.from(root.querySelectorAll("link"))) {
      const rel = (linkEl.getAttribute("rel") ?? "").trim().toLowerCase();
      if (rel !== LINK_REL_STYLESHEET) {
        droppedDangerousLinks.push(rel || "(no rel)");
        linkEl.remove();
      }
    }
  }

  // Pre-strip <meta> and <base> with the same iterator-safe walker. They are
  // also in FORBID_TAGS as a defence-in-depth, but DOMPurify's NodeIterator
  // can skip the next sibling after removing a forbidden element — leaving
  // an adjacent <meta>+<base> pair partially un-purified. querySelectorAll
  // returns a fresh static NodeList that doesn't suffer the skip.
  const prePassDroppedTags: string[] = [];
  for (const root of [parsed.head, parsed.body]) {
    for (const el of Array.from(root.querySelectorAll("meta, base"))) {
      prePassDroppedTags.push(el.nodeName.toLowerCase());
      el.remove();
    }
  }

  const scriptCount = parsed.querySelectorAll("script").length;
  const linkCount = parsed.querySelectorAll("link").length;

  const purify = createDOMPurify(globalThis.window);
  const purifyConfig = {
    ADD_TAGS: [...ADD_TAGS],
    FORBID_TAGS: [...FORBID_TAGS],
    ALLOWED_URI_REGEXP,
    KEEP_CONTENT: false,
  };

  // DOMPurify resets `purify.removed` at the start of each `sanitize()`
  // call, so we read it after each pass and accumulate. Filter to element
  // entries only — `removed` also collects per-attribute removals which
  // we don't surface here. We capture the lowercased nodeNames so the
  // boundary log carries identifiers, not just a count.
  const headHtml = purify.sanitize(parsed.head.innerHTML, purifyConfig);
  const headDroppedTags = purify.removed
    .filter((entry): entry is { element: Node } => "element" in entry)
    .map((entry) => entry.element.nodeName.toLowerCase());
  const bodyHtml = purify.sanitize(parsed.body.innerHTML, purifyConfig);
  const bodyDroppedTags = purify.removed
    .filter((entry): entry is { element: Node } => "element" in entry)
    .map((entry) => entry.element.nodeName.toLowerCase());
  const droppedTags: ReadonlyArray<string> = [
    ...prePassDroppedTags,
    ...headDroppedTags,
    ...bodyDroppedTags,
  ];

  console.info("[html-sanitize]", {
    scriptCount,
    linkCount,
    authorStyles: authorStyles.length,
    authorStylesBlocked,
    droppedTags,
    droppedDangerousLinks,
  });

  return {
    headHtml,
    bodyHtml,
    authorStyles,
    authorStylesBlocked,
    scriptCount,
    linkCount,
    droppedTags,
    droppedDangerousLinks,
  };
}
