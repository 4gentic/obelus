import type { FindSearchOptions } from "@obelus/review-shell";
import { beforeEach, describe, expect, it } from "vitest";
import { createHtmlFindProvider, type FindHostHooks } from "../find";

const OPTS: FindSearchOptions = { caseSensitive: false };

function mountText(text: string): HTMLElement {
  const p = document.createElement("p");
  p.appendChild(document.createTextNode(text));
  const mount = document.createElement("div");
  mount.appendChild(p);
  document.body.replaceChildren(mount);
  return mount;
}

function hooksFor(mount: HTMLElement): { hooks: FindHostHooks; ranges: Range[] } {
  const host = document.createElement("div");
  const ranges: Range[] = [];
  const hooks: FindHostHooks = {
    getMount: () => mount,
    getFrame: () => null,
    getHost: () => host,
    getScrollAncestor: () => host,
    paint: () => {},
    scrollMatchIntoView: (range) => {
      ranges.push(range);
    },
  };
  return { hooks, ranges };
}

describe("createHtmlFindProvider — typographic tolerance", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("matches an ASCII double-quoted query and the range covers the curly form", async () => {
    const open = String.fromCodePoint(0x201c);
    const close = String.fromCodePoint(0x201d);
    const mount = mountText(`${open}definition${close}`);
    const { hooks, ranges } = hooksFor(mount);
    const provider = createHtmlFindProvider(hooks);
    expect(await provider.search(`"definition"`, OPTS)).toBe(1);
    provider.goto(0);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.toString()).toBe(`${open}definition${close}`);
  });

  it("matches 'file' against an fi-ligature and the range covers the ligature", async () => {
    const fi = String.fromCodePoint(0xfb01);
    const mount = mountText(`the ${fi}le`);
    const { hooks, ranges } = hooksFor(mount);
    const provider = createHtmlFindProvider(hooks);
    expect(await provider.search("file", OPTS)).toBe(1);
    provider.goto(0);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.toString()).toBe(`${fi}le`);
    expect(ranges[0]?.toString()).toContain(fi);
  });
});
