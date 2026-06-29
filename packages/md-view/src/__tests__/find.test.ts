import type { FindSearchOptions } from "@obelus/review-shell";
import { beforeEach, describe, expect, it } from "vitest";
import { createMdFindProvider, type FindHostHooks } from "../find";

const OPTS: FindSearchOptions = { caseSensitive: false };

function mountText(text: string): HTMLElement {
  const p = document.createElement("p");
  p.appendChild(document.createTextNode(text));
  const container = document.createElement("div");
  container.appendChild(p);
  document.body.replaceChildren(container);
  return container;
}

function hooksFor(container: HTMLElement): FindHostHooks {
  const scroll = document.createElement("div");
  return {
    getContainer: () => container,
    getScrollAncestor: () => scroll,
    paint: () => {},
    scrollTo: () => {},
  };
}

describe("createMdFindProvider — typographic tolerance", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("matches an ASCII double-quoted query against smart curly quotes", async () => {
    const open = String.fromCodePoint(0x201c);
    const close = String.fromCodePoint(0x201d);
    const container = mountText(`${open}definition${close}`);
    const provider = createMdFindProvider(hooksFor(container));
    expect(await provider.search(`"definition"`, OPTS)).toBe(1);
  });

  it("matches the ASCII letters 'file' against an fi-ligature", async () => {
    const fi = String.fromCodePoint(0xfb01);
    const container = mountText(`the ${fi}le exists`);
    const provider = createMdFindProvider(hooksFor(container));
    expect(await provider.search("file", OPTS)).toBe(1);
  });
});
