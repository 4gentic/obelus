import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "../sanitize";

// happy-dom + DOMPurify don't strip every forbidden tag the way a real
// browser would (DOMPurify uses DOMParser internally, and happy-dom's
// implementation diverges). These tests therefore validate the config
// surface and the boundary-log accounting we own — they are NOT a
// substitute for the production browser smoke test that exercises the
// full sanitiser against a hostile HTML payload.

describe("sanitizeHtml", () => {
  it("returns the structured shape consumed by HtmlView and the ingest log", () => {
    const result = sanitizeHtml("<p>safe</p>");
    expect(result).toHaveProperty("headHtml");
    expect(result).toHaveProperty("bodyHtml");
    expect(result).toHaveProperty("authorStyles");
    expect(result).toHaveProperty("scriptCount");
    expect(result).toHaveProperty("linkCount");
    expect(result).toHaveProperty("droppedTags");
    expect(result).toHaveProperty("droppedDangerousLinks");
    expect(Array.isArray(result.droppedTags)).toBe(true);
    expect(typeof result.bodyHtml).toBe("string");
    expect(Array.isArray(result.authorStyles)).toBe(true);
    expect(typeof result.scriptCount).toBe("number");
  });

  it("preserves a plain paragraph round-trip", () => {
    const result = sanitizeHtml("<p>hello world</p>");
    expect(result.bodyHtml).toContain("<p>hello world</p>");
    expect(result.scriptCount).toBe(0);
    expect(result.linkCount).toBe(0);
  });

  it("strips <script> tags so author code cannot reach the parent IPC bridge", () => {
    // The iframe is same-origin (parent needs `contentWindow.getSelection()`),
    // so any surviving author script would be able to call
    // `parent.__TAURI_INTERNALS__.invoke(...)`. DOMPurify removes <script>
    // entirely; the count is still recorded for boundary logging.
    const result = sanitizeHtml(
      "<p>safe</p>" +
        "<script>window.parent.__TAURI_INTERNALS__.invoke('plugin:sql|select')</script>",
    );
    expect(result.scriptCount).toBe(1);
    expect(result.bodyHtml).toContain("<p>safe</p>");
    expect(result.bodyHtml).not.toContain("<script");
    expect(result.bodyHtml).not.toContain("__TAURI_INTERNALS__");
  });

  it("strips <script src> too — even with src already rewritten to data:,", () => {
    const result = sanitizeHtml('<script src="data:,"></script><p>after</p>');
    expect(result.bodyHtml).not.toContain("<script");
    expect(result.bodyHtml).toContain("<p>after</p>");
  });

  it("preserves <link rel=stylesheet> and counts it", () => {
    const result = sanitizeHtml(
      '<!doctype html><html><head><link rel="stylesheet" href="theme.css"></head><body><p>x</p></body></html>',
    );
    expect(result.linkCount).toBe(1);
    expect(result.headHtml).toContain('rel="stylesheet"');
    expect(result.headHtml).toContain('href="theme.css"');
  });

  it("strips <link> elements with non-stylesheet rels", () => {
    const result = sanitizeHtml(
      "<!doctype html><html><head>" +
        '<link rel="preconnect" href="https://fonts.googleapis.com">' +
        '<link rel="dns-prefetch" href="https://cdn.example.com">' +
        '<link rel="preload" as="font" href="x.woff2">' +
        '<link rel="modulepreload" href="x.js">' +
        '<link rel="icon" href="favicon.ico">' +
        '<link rel="stylesheet" href="ok.css">' +
        "</head><body></body></html>",
    );
    expect(result.linkCount).toBe(1); // only the stylesheet survives
    expect(result.droppedDangerousLinks).toEqual(
      expect.arrayContaining(["preconnect", "dns-prefetch", "preload", "modulepreload", "icon"]),
    );
    expect(result.headHtml).not.toMatch(/rel="preconnect"/);
    expect(result.headHtml).not.toMatch(/rel="dns-prefetch"/);
    expect(result.headHtml).not.toMatch(/rel="preload"/);
    expect(result.headHtml).toContain('rel="stylesheet"');
  });

  it("preserves http(s), blob:, data:, fragment, and relative href values", () => {
    const result = sanitizeHtml(
      '<a href="https://e.com/x">a</a>' +
        '<a href="blob:abc">b</a>' +
        '<a href="data:text/plain,hi">c</a>' +
        '<a href="#section">d</a>' +
        '<a href="figs/x.png">e</a>',
    );
    expect(result.bodyHtml).toContain('href="https://e.com/x"');
    expect(result.bodyHtml).toContain('href="blob:abc"');
    expect(result.bodyHtml).toContain("data:text/plain");
    expect(result.bodyHtml).toContain('href="#section"');
    expect(result.bodyHtml).toContain('href="figs/x.png"');
  });

  it("rejects javascript: URLs in href", () => {
    const result = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
    expect(result.bodyHtml).not.toMatch(/javascript:/i);
  });

  it("removes inline event handlers (DOMPurify default)", () => {
    const result = sanitizeHtml('<button onclick="boom()">x</button>');
    expect(result.bodyHtml).not.toContain("onclick");
    expect(result.bodyHtml).toContain("<button");
  });

  it("extracts a body <style> block into authorStyles", () => {
    const result = sanitizeHtml("<style>p { color: red }</style><p>x</p>");
    expect(result.bodyHtml).not.toContain("<style>");
    expect(result.authorStyles).toHaveLength(1);
    expect(result.authorStyles[0]).toContain("color: red");
  });

  it("extracts <style> from <head> of a full document into authorStyles", () => {
    const result = sanitizeHtml(
      "<!doctype html><html><head><title>t</title>" +
        "<style>:root { --bg: #000 }</style>" +
        "</head><body><p>hello</p></body></html>",
    );
    expect(result.authorStyles).toHaveLength(1);
    expect(result.authorStyles[0]).toContain("--bg");
    expect(result.bodyHtml).toContain("<p>hello</p>");
  });

  it("preserves authoring order — head styles first, then body styles", () => {
    const result = sanitizeHtml(
      "<!doctype html><html><head><style>head { color: a }</style></head>" +
        "<body><style>body { color: b }</style><p>x</p></body></html>",
    );
    expect(result.authorStyles).toHaveLength(2);
    expect(result.authorStyles[0]).toContain("color: a");
    expect(result.authorStyles[1]).toContain("color: b");
  });

  it("preserves inline style attributes on body elements", () => {
    const result = sanitizeHtml('<p style="color: blue">hi</p>');
    expect(result.bodyHtml).toContain('style="color: blue"');
  });

  it("scrubs external url() out of author <style> blocks and reports the originals", () => {
    const result = sanitizeHtml(
      "<style>" +
        '@import url("https://fonts.googleapis.com/css2?family=Inter");' +
        " body { background: url(https://e/bg.png); }" +
        "</style><p>x</p>",
    );
    expect(result.authorStyles).toHaveLength(1);
    expect(result.authorStyles[0]).not.toContain("https://");
    expect(result.authorStyles[0]).toContain("url(data:,)");
    expect(result.authorStylesBlocked).toEqual([
      "https://fonts.googleapis.com/css2?family=Inter",
      "https://e/bg.png",
    ]);
  });

  it("preserves relative url() inside author <style> blocks", () => {
    const result = sanitizeHtml(
      "<style>body { background: url(./local.png); cursor: url(data:image/png;base64,AAA) }</style>",
    );
    expect(result.authorStyles[0]).toContain("url(./local.png)");
    expect(result.authorStyles[0]).toContain("url(data:image/png;base64,AAA)");
    expect(result.authorStylesBlocked).toEqual([]);
  });

  it("strips author <meta http-equiv> so the CSP injected by HtmlView cannot be overridden", () => {
    // DOMPurify reliably drops a single forbidden tag; with multiple
    // forbidden siblings its iterator can skip ahead and miss the next
    // one, but that's defense-in-depth here — the host srcdoc places its
    // own CSP <meta> *first* and CSP intersection means an author meta
    // can only add restrictions, never relax them.
    const result = sanitizeHtml(
      "<!doctype html><html><head>" +
        '<meta http-equiv="Content-Security-Policy" content="connect-src *">' +
        "</head><body><p>x</p></body></html>",
    );
    expect(result.headHtml).not.toContain("Content-Security-Policy");
    expect(result.droppedTags).toContain("meta");
  });

  it("strips <base> so author can't re-base relative URLs to an attacker origin", () => {
    // Without forbidding <base>, a single `<base href="https://evil/">` in
    // <head> would make the iframe's CSS engine and any surviving relative
    // <a href> resolve against an external origin — undoing the asset
    // rewrite that turns relatives into local blobs.
    const result = sanitizeHtml(
      "<!doctype html><html><head>" +
        '<base href="https://evil.example/">' +
        "</head><body><p>x</p></body></html>",
    );
    expect(result.headHtml).not.toContain("<base");
    expect(result.droppedTags).toContain("base");
  });
});
