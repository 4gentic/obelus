import { Window } from "happy-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { findImageTarget, quoteForImage } from "../image";

let win: Window;
let doc: Document;

beforeEach(() => {
  win = new Window();
  doc = win.document as unknown as Document;
});

describe("findImageTarget", () => {
  it("returns the image when the click landed on it", () => {
    const img = doc.createElement("img");
    expect(findImageTarget(img)).toBe(img);
  });

  it("walks up from a child of <picture> to its <img>", () => {
    const picture = doc.createElement("picture");
    const source = doc.createElement("source");
    const img = doc.createElement("img");
    picture.appendChild(source);
    picture.appendChild(img);

    expect(findImageTarget(source)).toBe(img);
  });

  it("returns null when the click is on prose", () => {
    const p = doc.createElement("p");
    p.textContent = "no image here";
    expect(findImageTarget(p.firstChild)).toBeNull();
  });

  it("stops at the bound", () => {
    const outer = doc.createElement("div");
    const innerImg = doc.createElement("img");
    outer.appendChild(innerImg);
    // Bound at outer means a node above outer (would need an img *below* bound to match).
    expect(findImageTarget(innerImg, outer)).toBe(innerImg);
  });
});

describe("quoteForImage", () => {
  it("prefers non-empty alt text", () => {
    const img = doc.createElement("img");
    img.setAttribute("alt", "  diagram of pier  ");
    img.setAttribute("src", "fig.png");
    expect(quoteForImage(img as unknown as HTMLElement)).toBe("diagram of pier");
  });

  it("falls back to filename basename when alt is empty", () => {
    const img = doc.createElement("img");
    img.setAttribute("alt", "");
    img.setAttribute("src", "figs/diagram.png");
    expect(quoteForImage(img as unknown as HTMLElement)).toBe("[image: diagram.png]");
  });

  it("uses data-blocked-src when external image was rewritten to a placeholder", () => {
    const img = doc.createElement("img");
    img.setAttribute("alt", "");
    img.setAttribute("src", "data:,");
    img.setAttribute("data-blocked-src", "https://example.com/path/photo.jpg?x=1");
    expect(quoteForImage(img as unknown as HTMLElement)).toBe("[image: photo.jpg]");
  });

  it("returns a generic placeholder when neither alt nor a usable src is present", () => {
    const img = doc.createElement("img");
    expect(quoteForImage(img as unknown as HTMLElement)).toBe("[image]");
  });
});
