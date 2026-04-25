import { useEffect, useMemo, useRef } from "react";

// Mirrors the AssetResolver shape exposed by @obelus/html-view (re-exported
// from @obelus/source-render/browser). Declared locally rather than imported
// so apps/web doesn't need to take @obelus/source-render as a transitive
// type-resolution dep just for one structural interface; structural typing
// makes the two compatible at the call site in review.tsx.
type AssetResolver = {
  resolve(path: string): Promise<string | null>;
};

// Web stub: a paper picked through the web library lands in OPFS as a single
// HTML blob — there are no sibling figures to resolve. This hook mirrors the
// desktop AssetResolver shape (apps/desktop/src/routes/project/use-asset-resolver.ts)
// so HtmlReviewSurface is wired uniformly across surfaces. Returns null for
// every path today; when a folder-import flow stages sibling assets into OPFS
// keyed by paper sha + relative path, the resolve() body will read them out
// and mint blob URLs.
export function useOpfsAssetResolver(): AssetResolver {
  const urlsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  return useMemo<AssetResolver>(
    () => ({
      async resolve(_path: string): Promise<string | null> {
        return null;
      },
    }),
    [],
  );
}
