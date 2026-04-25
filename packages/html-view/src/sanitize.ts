import createDOMPurify from "dompurify";

const FORBID_TAGS: ReadonlyArray<string> = ["script", "iframe", "object", "embed", "link", "meta"];

// Permits relative paths, http(s), blob:, data:, and in-document fragments.
// `javascript:` and other arbitrary schemes are rejected by the negative
// lookahead. Offline papers never need remote schemes beyond http(s); the
// asset rewriter typically replaces those with blob: URLs before mount.
const ALLOWED_URI_REGEXP = /^(?:(?:[a-z]+:)?\/\/)?(?!javascript:)|^blob:|^data:|^#/i;

export interface SanitizeResult {
  html: string;
  droppedScripts: number;
}

export function sanitizeHtml(input: string): SanitizeResult {
  const purify = createDOMPurify(globalThis.window);
  let droppedScripts = 0;
  // Hook fires once per element node before DOMPurify's tag-filter decides to
  // keep or drop it. `<script>` count is a meaningful signal for the ingest
  // boundary log; other forbidden tags collapse into the same audit channel
  // but aren't broken out (DOMPurify exposes a generic `removed` array we
  // don't currently surface).
  const onUpcomingNode = (node: Node): void => {
    if (node.nodeType !== 1) return;
    const tag = (node as Element).tagName.toLowerCase();
    if (tag === "script") droppedScripts += 1;
  };
  purify.addHook("uponSanitizeElement", onUpcomingNode);
  const html = purify.sanitize(input, {
    FORBID_TAGS: [...FORBID_TAGS],
    ALLOWED_URI_REGEXP,
    KEEP_CONTENT: false,
  });
  purify.removeHook("uponSanitizeElement");
  return { html, droppedScripts };
}
