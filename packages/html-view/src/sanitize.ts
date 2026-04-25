import createDOMPurify from "dompurify";

// Tags we explicitly add to DOMPurify's allow-list. Both are dangerous by
// default. Inside the iframe sandbox, scripts run under a strict CSP that
// blocks all network egress; <link rel=stylesheet> is the only surviving
// link rel — others (preconnect, dns-prefetch, preload, modulepreload, etc.)
// are pre-stripped before DOMPurify runs.
const ADD_TAGS: ReadonlyArray<string> = ["script", "link"];

// Tags we forbid even if DOMPurify's defaults would allow them. <meta> is
// forbidden so author content can't override the CSP <meta http-equiv> the
// host frame injects. <iframe>/<object>/<embed> are dangerous; authors who
// need video can use <video>/<audio>.
const FORBID_TAGS: ReadonlyArray<string> = ["iframe", "object", "embed", "meta"];

// Permits relative paths, http(s), blob:, data:, and in-document fragments.
// `javascript:` and other arbitrary schemes are rejected by the negative
// lookahead. Offline papers never need remote schemes beyond http(s); the
// asset rewriter typically replaces those with blob: URLs before mount, and
// the iframe CSP refuses external network loads regardless.
const ALLOWED_URI_REGEXP = /^(?:(?:[a-z]+:)?\/\/)?(?!javascript:)|^blob:|^data:|^#/i;

const LINK_REL_STYLESHEET = "stylesheet";

export interface SanitizeResult {
  // Sanitized <head> contents, with author <style> blocks removed (their
  // CSS is in `authorStyles`). Surviving <link rel=stylesheet>, <script>,
  // and <title> elements appear here verbatim.
  headHtml: string;
  // Sanitized <body> contents.
  bodyHtml: string;
  // CSS text from each author <style> block in the original document
  // (head and body, in that order). Returned verbatim — DOMPurify is
  // intentionally bypassed for these so values it doesn't recognize
  // (`:root` custom properties, complex selectors) survive intact.
  authorStyles: ReadonlyArray<string>;
  // Boundary-log accounting (see CLAUDE.md "Tracing at ingest boundaries").
  scriptCount: number;
  linkCount: number;
  droppedTagCount: number;
  droppedDangerousLinks: ReadonlyArray<string>;
}

export function sanitizeHtml(input: string): SanitizeResult {
  // Parse first. DOMParser tolerates both fragments and full documents:
  // a fragment becomes <html><head/><body>{fragment}</body></html>, so the
  // same path handles both.
  const parsed = new DOMParser().parseFromString(input, "text/html");

  const authorStyles: string[] = [];
  for (const root of [parsed.head, parsed.body]) {
    for (const styleEl of Array.from(root.querySelectorAll("style"))) {
      authorStyles.push(styleEl.textContent ?? "");
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
  // we don't surface here.
  const headHtml = purify.sanitize(parsed.head.innerHTML, purifyConfig);
  const headDroppedTagCount = purify.removed.filter(
    (entry): entry is { element: Node } => "element" in entry,
  ).length;
  const bodyHtml = purify.sanitize(parsed.body.innerHTML, purifyConfig);
  const bodyDroppedTagCount = purify.removed.filter(
    (entry): entry is { element: Node } => "element" in entry,
  ).length;
  const droppedTagCount = headDroppedTagCount + bodyDroppedTagCount;

  console.info("[html-sanitize]", {
    scriptCount,
    linkCount,
    authorStylesCount: authorStyles.length,
    droppedTagCount,
    droppedDangerousLinks,
  });

  return {
    headHtml,
    bodyHtml,
    authorStyles,
    scriptCount,
    linkCount,
    droppedTagCount,
    droppedDangerousLinks,
  };
}
