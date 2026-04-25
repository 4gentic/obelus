import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AssetResolver, rewriteRelativeAssets } from "../asset-rewrite.js";

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
});
