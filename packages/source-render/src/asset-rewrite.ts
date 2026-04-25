// Resolves a relative path (as seen in src/href) to a usable URL — typically a
// `blob:` URL backed by an OPFS read or a Tauri FS read. Returning null marks
// the asset as missing; the rewrite walk records it for boundary logging.
export interface AssetResolver {
  resolve(relPath: string): Promise<string | null>;
}

const ABSOLUTE_OR_NON_FILE = /^(?:[a-z]+:|\/\/|#|data:|blob:)/i;
// Matches `http://`, `https://`, and protocol-relative `//host` — every URL
// that would issue a fetch over the network on parse. Anything else (data:,
// blob:, relative, in-document fragment) is local.
const EXTERNAL_URL = /^(?:https?:)?\/\//i;
const SRCSET_DESCRIPTOR = /^\d+(?:\.\d+)?[xw]$/;

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
// the html-iframe path (author-provided `<link>`/`<script>` plus media,
// SVG `<image>`/`<use>`, and the `srcset`/`imagesrcset`/`poster`
// secondary loaders that the browser fetches in parallel with `src`).
type BlockTarget = { tag: string; attr: string; kind: "scalar" | "srcset" };

const BLOCK_TARGETS: ReadonlyArray<BlockTarget> = [
  { tag: "img", attr: "src", kind: "scalar" },
  { tag: "img", attr: "srcset", kind: "srcset" },
  { tag: "source", attr: "src", kind: "scalar" },
  { tag: "source", attr: "srcset", kind: "srcset" },
  { tag: "link", attr: "href", kind: "scalar" },
  { tag: "link", attr: "imagesrcset", kind: "srcset" },
  { tag: "script", attr: "src", kind: "scalar" },
  { tag: "video", attr: "src", kind: "scalar" },
  { tag: "video", attr: "poster", kind: "scalar" },
  { tag: "audio", attr: "src", kind: "scalar" },
  { tag: "track", attr: "src", kind: "scalar" },
  { tag: "image", attr: "href", kind: "scalar" },
  { tag: "image", attr: "xlink:href", kind: "scalar" },
  { tag: "use", attr: "href", kind: "scalar" },
  { tag: "use", attr: "xlink:href", kind: "scalar" },
];

function isRelative(value: string): boolean {
  if (value === "") return false;
  return !ABSOLUTE_OR_NON_FILE.test(value);
}

// Splits an `srcset` / `imagesrcset` value, replaces external candidates
// with `data:,`, and reports the originals. Per WHATWG HTML §4.8.4.2 the
// candidate list is comma-separated and commas inside URLs are forbidden,
// so a plain split is correct. The optional descriptor (`1x`/`2x`/`100w`)
// is preserved alongside its candidate.
function blockExternalSrcset(value: string): { srcset: string; blocked: string[] } {
  const blocked: string[] = [];
  const candidates = value.split(",");
  const rebuilt: string[] = [];
  for (const raw of candidates) {
    const trimmed = raw.trim();
    if (trimmed === "") {
      rebuilt.push(trimmed);
      continue;
    }
    const tokens = trimmed.split(/\s+/);
    const last = tokens[tokens.length - 1] ?? "";
    const hasDescriptor = tokens.length > 1 && SRCSET_DESCRIPTOR.test(last);
    const url = hasDescriptor ? tokens.slice(0, -1).join(" ") : trimmed;
    const descriptor = hasDescriptor ? last : "";
    if (EXTERNAL_URL.test(url)) {
      blocked.push(url);
      rebuilt.push(descriptor ? `data:, ${descriptor}` : "data:,");
    } else {
      rebuilt.push(descriptor ? `${url} ${descriptor}` : url);
    }
  }
  return { srcset: rebuilt.join(", "), blocked };
}

// Replaces external `url(...)` references and bare-string `@import` URLs
// inside CSS text with `data:,` placeholders. Used by `blockExternalAssets`
// for inline `style` attributes and by `sanitize.ts` for verbatim author
// `<style>` blocks (which DOMPurify intentionally bypasses). The scanner
// is a small state machine — it tracks block comments and string literals
// so a `url(https://...)` inside a comment or quoted attribute value is
// not treated as a load.
export function scrubExternalCssUrls(css: string): { css: string; blocked: string[] } {
  const blocked: string[] = [];
  let out = "";
  let i = 0;
  const n = css.length;

  while (i < n) {
    const c = css[i] ?? "";

    // Block comment — pass through verbatim, do not look inside.
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end === -1) {
        out += css.slice(i);
        break;
      }
      out += css.slice(i, end + 2);
      i = end + 2;
      continue;
    }

    // String literal at top level — pass through verbatim. The `url(...)`
    // and `@import` matchers below intentionally do not run inside strings,
    // so a `content: "url(https://x)"` value never triggers a rewrite.
    if (c === '"' || c === "'") {
      const start = i;
      i += 1;
      while (i < n) {
        const ch = css[i] ?? "";
        if (ch === "\\" && i + 1 < n) {
          i += 2;
          continue;
        }
        if (ch === c) {
          i += 1;
          break;
        }
        i += 1;
      }
      out += css.slice(start, i);
      continue;
    }

    // url(...) — case-insensitive, not preceded by an identifier char so
    // that `myurl(...)` (made-up, but defensive) doesn't match.
    if (
      (c === "u" || c === "U") &&
      i + 4 <= n &&
      css.slice(i, i + 4).toLowerCase() === "url(" &&
      !isIdentChar(css[i - 1])
    ) {
      const close = scanUrlClose(css, i + 4);
      if (close === -1) {
        out += css.slice(i);
        break;
      }
      const inner = css.slice(i + 4, close);
      const url = unwrapUrl(inner);
      if (EXTERNAL_URL.test(url)) {
        blocked.push(url);
        out += "url(data:,)";
      } else {
        out += css.slice(i, close + 1);
      }
      i = close + 1;
      continue;
    }

    // @import "..." (bare-string form). The `@import url(...)` form is
    // already covered by the url() branch above.
    if (
      c === "@" &&
      i + 7 <= n &&
      css.slice(i, i + 7).toLowerCase() === "@import" &&
      !isIdentChar(css[i - 1]) &&
      !isIdentChar(css[i + 7])
    ) {
      let j = i + 7;
      while (j < n && isWs(css[j])) j += 1;
      const ch = css[j] ?? "";
      if (ch === '"' || ch === "'") {
        const urlStart = j + 1;
        let k = urlStart;
        while (k < n) {
          const c2 = css[k] ?? "";
          if (c2 === "\\" && k + 1 < n) {
            k += 2;
            continue;
          }
          if (c2 === ch) break;
          k += 1;
        }
        const url = css.slice(urlStart, k).trim();
        const closeQuote = k < n ? k + 1 : k;
        if (EXTERNAL_URL.test(url)) {
          blocked.push(url);
          out += `${css.slice(i, j)}${ch}data:,${ch}`;
        } else {
          out += css.slice(i, closeQuote);
        }
        i = closeQuote;
        continue;
      }
    }

    out += c;
    i += 1;
  }

  return { css: out, blocked };
}

function scanUrlClose(css: string, from: number): number {
  // Skip leading whitespace inside url(
  let k = from;
  while (k < css.length && isWs(css[k])) k += 1;
  const opener = css[k] ?? "";
  if (opener === '"' || opener === "'") {
    k += 1;
    while (k < css.length) {
      const ch = css[k] ?? "";
      if (ch === "\\" && k + 1 < css.length) {
        k += 2;
        continue;
      }
      if (ch === opener) {
        k += 1;
        break;
      }
      k += 1;
    }
  }
  while (k < css.length && css[k] !== ")") k += 1;
  return k < css.length ? k : -1;
}

function unwrapUrl(inner: string): string {
  let s = inner.trim();
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      s = s.slice(1, -1);
    }
  }
  return s.trim();
}

function isIdentChar(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  return /[a-zA-Z0-9_-]/.test(ch);
}

function isWs(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f";
}

// Synchronously rewrites every auto-loading URL attribute and CSS `url(...)`
// reference in a rendered HTML fragment to a `data:,` placeholder, returning
// the gated string and the original URLs. Used by MarkdownView (which has
// no iframe / CSP) and by HtmlView (where WebKit's CSP-via-meta support in
// srcdoc iframes is unreliable, so the rewrite is the actual enforcement)
// to honour the offline default before the browser parses the HTML and
// starts fetching. The opt-out is the host surface's per-paper trust
// state — see `apps/desktop/src/store/app-state.ts` and
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
  for (const target of BLOCK_TARGETS) {
    for (const el of Array.from(root.querySelectorAll(target.tag))) {
      const value = el.getAttribute(target.attr);
      if (value === null) continue;
      if (target.kind === "srcset") {
        const result = blockExternalSrcset(value);
        if (result.blocked.length === 0) continue;
        for (const uri of result.blocked) blocked.push(uri);
        el.setAttribute(`data-blocked-${target.attr}`, value);
        el.setAttribute(target.attr, result.srcset);
        continue;
      }
      if (!EXTERNAL_URL.test(value)) continue;
      blocked.push(value);
      el.setAttribute("data-blocked-src", value);
      el.setAttribute(target.attr, "data:,");
    }
  }
  for (const el of Array.from(root.querySelectorAll("[style]"))) {
    const value = el.getAttribute("style");
    if (value === null) continue;
    const result = scrubExternalCssUrls(value);
    if (result.blocked.length === 0) continue;
    for (const uri of result.blocked) blocked.push(uri);
    el.setAttribute("style", result.css);
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
