import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AssetResolver,
  blockExternalAssets,
  rewriteRelativeAssets,
} from "../asset-rewrite.js";

function fakeResolver(map: Record<string, string | null>): AssetResolver {
  return {
    resolve: async (relPath) => (Object.hasOwn(map, relPath) ? (map[relPath] ?? null) : null),
  };
}

// Mounts an HTML fragment via DOMParser (avoids the innerHTML guard) and
// returns the wrapper element imported into the live document.
function mount(fragment: string): HTMLElement {
  const parsed = new DOMParser().parseFromString(`<div>${fragment}</div>`, "text/html");
  const root = parsed.body.firstElementChild;
  if (!root) throw new Error("DOMParser returned no root");
  const wrapper = document.importNode(root, true) as HTMLElement;
  document.body.replaceChildren(wrapper);
  return wrapper;
}

describe("rewriteRelativeAssets", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rewrites relative <img src> to a resolved blob URL", async () => {
    const root = mount('<img src="figs/diagram.png" alt="diagram" />');
    const result = await rewriteRelativeAssets(
      root,
      fakeResolver({ "figs/diagram.png": "blob:abc-123" }),
    );
    expect(result.rewritten).toBe(1);
    expect(result.missing).toEqual([]);
    expect(root.querySelector("img")?.getAttribute("src")).toBe("blob:abc-123");
  });

  it("leaves absolute and protocol-relative URLs untouched", async () => {
    const root = mount(
      '<img src="https://example.com/x.png" />' +
        '<img src="//cdn.example/y.png" />' +
        '<img src="data:image/png;base64,AAA" />' +
        '<img src="blob:keep" />' +
        '<a href="#anchor">jump</a>',
    );
    const resolver = fakeResolver({});
    const spy = vi.spyOn(resolver, "resolve");
    const result = await rewriteRelativeAssets(root, resolver);
    expect(spy).not.toHaveBeenCalled();
    expect(result.rewritten).toBe(0);
    expect(result.missing).toEqual([]);
  });

  it("records missing assets without mutating the attribute", async () => {
    const root = mount('<img src="missing/figure.png" />');
    const result = await rewriteRelativeAssets(root, fakeResolver({}));
    expect(result.rewritten).toBe(0);
    expect(result.missing).toEqual(["missing/figure.png"]);
    expect(root.querySelector("img")?.getAttribute("src")).toBe("missing/figure.png");
  });

  it("rewrites <source>, <img>, and <a href> in the same pass", async () => {
    const root = mount(
      "<picture>" +
        '<source src="hi.webp" />' +
        '<img src="lo.png" />' +
        "</picture>" +
        '<a href="paper.pdf">paper</a>',
    );
    const result = await rewriteRelativeAssets(
      root,
      fakeResolver({
        "hi.webp": "blob:hi",
        "lo.png": "blob:lo",
        "paper.pdf": "blob:paper",
      }),
    );
    expect(result.rewritten).toBe(3);
    expect(root.querySelector("source")?.getAttribute("src")).toBe("blob:hi");
    expect(root.querySelector("img")?.getAttribute("src")).toBe("blob:lo");
    expect(root.querySelector("a")?.getAttribute("href")).toBe("blob:paper");
  });

  it("is idempotent: a second pass over rewritten elements is a no-op", async () => {
    const root = mount('<img src="figs/x.png" />');
    const resolver = fakeResolver({ "figs/x.png": "blob:once" });
    const first = await rewriteRelativeAssets(root, resolver);
    expect(first.rewritten).toBe(1);
    const second = await rewriteRelativeAssets(root, resolver);
    expect(second.rewritten).toBe(0);
    expect(second.missing).toEqual([]);
  });

  it("rewrites a relative <link rel=stylesheet href> to a resolved blob URL", async () => {
    const root = mount('<link rel="stylesheet" href="theme.css" />');
    const result = await rewriteRelativeAssets(root, fakeResolver({ "theme.css": "blob:theme-1" }));
    expect(result.rewritten).toBe(1);
    expect(root.querySelector("link")?.getAttribute("href")).toBe("blob:theme-1");
  });

  it("rewrites a relative <script src> to a resolved blob URL", async () => {
    const root = mount('<script src="canvas/app.js"></script>');
    const result = await rewriteRelativeAssets(
      root,
      fakeResolver({ "canvas/app.js": "blob:canvas-1" }),
    );
    expect(result.rewritten).toBe(1);
    expect(root.querySelector("script")?.getAttribute("src")).toBe("blob:canvas-1");
  });

  it("leaves absolute <link href> and <script src> alone", async () => {
    const root = mount(
      '<link rel="stylesheet" href="https://cdn.example.com/foo.css" />' +
        '<script src="https://cdn.example.com/bar.js"></script>',
    );
    const resolver = fakeResolver({});
    const spy = vi.spyOn(resolver, "resolve");
    const result = await rewriteRelativeAssets(root, resolver);
    expect(spy).not.toHaveBeenCalled();
    expect(result.rewritten).toBe(0);
    expect(result.missing).toEqual([]);
    expect(root.querySelector("link")?.getAttribute("href")).toBe(
      "https://cdn.example.com/foo.css",
    );
  });
});

describe("blockExternalAssets", () => {
  it("rewrites external <img> to a placeholder and reports the URL", () => {
    const result = blockExternalAssets(
      '<p><img src="https://cdn.example.com/figure.png" alt="figure"></p>',
    );
    expect(result.blocked).toEqual(["https://cdn.example.com/figure.png"]);
    expect(result.html).toContain('src="data:,"');
    expect(result.html).toContain('data-blocked-src="https://cdn.example.com/figure.png"');
  });

  it("rewrites external <source src> the same way", () => {
    const result = blockExternalAssets(
      '<picture><source src="https://cdn.example.com/hi.webp"></picture>',
    );
    expect(result.blocked).toEqual(["https://cdn.example.com/hi.webp"]);
    expect(result.html).toContain('data-blocked-src="https://cdn.example.com/hi.webp"');
  });

  it("leaves relative URLs untouched (the asset resolver handles those)", () => {
    const result = blockExternalAssets('<img src="figs/x.png">');
    expect(result.blocked).toEqual([]);
    expect(result.html).toContain('src="figs/x.png"');
  });

  it("leaves blob:, data:, and fragment URLs untouched", () => {
    const result = blockExternalAssets(
      '<img src="blob:abc"><img src="data:image/png;base64,AAA"><a href="#section">x</a>',
    );
    expect(result.blocked).toEqual([]);
  });

  it("does not block <a href=https://...> — link clicks are user gestures, not auto-fetches", () => {
    const result = blockExternalAssets('<a href="https://example.com/paper.pdf">paper</a>');
    expect(result.blocked).toEqual([]);
    expect(result.html).toContain('href="https://example.com/paper.pdf"');
  });

  it("rewrites external <link rel=stylesheet> in head context", () => {
    const result = blockExternalAssets(
      "<title>Paper</title>" +
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">',
      "head",
    );
    expect(result.blocked).toEqual(["https://fonts.googleapis.com/css2?family=Inter"]);
    expect(result.html).toContain('href="data:,"');
    expect(result.html).toContain(
      'data-blocked-src="https://fonts.googleapis.com/css2?family=Inter"',
    );
    // The title (non-blocked sibling) round-trips intact.
    expect(result.html).toContain("<title>Paper</title>");
  });

  it("rewrites external <script src> in head context", () => {
    const result = blockExternalAssets(
      '<script src="https://cdn.example.com/canvas.js"></script>',
      "head",
    );
    expect(result.blocked).toEqual(["https://cdn.example.com/canvas.js"]);
    expect(result.html).toContain('src="data:,"');
    expect(result.html).toContain('data-blocked-src="https://cdn.example.com/canvas.js"');
  });

  it("preserves a head fragment's structure end-to-end", () => {
    // The HTML5 parser would normally relocate <link>/<script> out of body
    // context. The `slot` parameter wraps in <head> so the round-trip
    // keeps every element in place.
    const input =
      '<meta charset="utf-8">' +
      "<title>x</title>" +
      '<link rel="stylesheet" href="https://cdn.example.com/a.css">' +
      '<script src="https://cdn.example.com/b.js"></script>';
    const result = blockExternalAssets(input, "head");
    expect(result.blocked).toEqual([
      "https://cdn.example.com/a.css",
      "https://cdn.example.com/b.js",
    ]);
    expect(result.html).toContain("<title>x</title>");
    expect(result.html).toContain('<link rel="stylesheet"');
    expect(result.html).toContain("<script");
  });
});
