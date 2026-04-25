// Resolves a relative path (as seen in src/href) to a usable URL — typically a
// `blob:` URL backed by an OPFS read or a Tauri FS read. Returning null marks
// the asset as missing; the rewrite walk records it for boundary logging.
export interface AssetResolver {
  resolve(relPath: string): Promise<string | null>;
}

const ABSOLUTE_OR_NON_FILE = /^(?:[a-z]+:|\/\/|#|data:|blob:)/i;

const REWRITE_TARGETS: ReadonlyArray<{ tag: string; attr: string }> = [
  { tag: "img", attr: "src" },
  { tag: "source", attr: "src" },
  { tag: "a", attr: "href" },
];

function isRelative(value: string): boolean {
  if (value === "") return false;
  return !ABSOLUTE_OR_NON_FILE.test(value);
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
