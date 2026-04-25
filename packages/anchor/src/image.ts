// Synthesises the `quote` field for an image-anchored mark. Prefers the
// element's `alt` text — it survives the bundle round-trip when the source is
// markdown (the alt is part of `![alt](path)`). Falls back to a
// `[image: filename]` placeholder so callers always have a non-empty quote
// (`AnnotationV2.quote` is `min(1)`) even for empty-alt images.
//
// `data-blocked-src` carries the original `src` for external images that the
// trust gate replaced with a `data:,` placeholder; we prefer it over the
// rewritten `src` so the quote names the URL the author wrote.
const ELEMENT_NODE = 1;

function basenameFromUrl(raw: string): string | null {
  try {
    const url = new URL(raw, "http://_local_");
    const pathname = url.pathname;
    const last = pathname
      .split("/")
      .filter((p) => p !== "")
      .pop();
    if (last) return decodeURIComponent(last);
  } catch {
    // raw isn't a parseable URL — fall through to plain-string handling.
  }
  const segments = raw
    .split(/[?#]/, 1)[0]
    ?.split("/")
    .filter((p) => p !== "");
  if (segments && segments.length > 0) return segments[segments.length - 1] ?? null;
  return null;
}

export function quoteForImage(img: HTMLElement): string {
  const alt = img.getAttribute("alt")?.trim();
  if (alt && alt.length > 0) return alt;
  const blocked = img.getAttribute("data-blocked-src");
  const src = img.getAttribute("src");
  const candidate = blocked ?? src ?? "";
  const base = basenameFromUrl(candidate);
  return base ? `[image: ${base}]` : "[image]";
}

// Walks up from `node` to the nearest `<img>` element, stopping at `bound`
// (exclusive) if provided. `<picture>` resolves through to its `<img>` child.
// Returns null when no image is reachable — including when the click landed
// on a `<source>` outside any `<picture>`.
export function findImageTarget(node: Node | null, bound?: Node): HTMLElement | null {
  let current: Node | null = node;
  while (current && current !== bound) {
    if (current.nodeType === ELEMENT_NODE) {
      const el = current as HTMLElement;
      const tag = el.tagName.toLowerCase();
      if (tag === "img") return el;
      if (tag === "picture") {
        const inner = el.querySelector("img");
        return inner ? (inner as HTMLElement) : null;
      }
    }
    current = current.parentNode;
  }
  return null;
}
