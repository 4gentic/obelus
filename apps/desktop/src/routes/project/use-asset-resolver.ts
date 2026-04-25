import type { AssetResolver } from "@obelus/html-view";
import { useEffect, useMemo, useRef } from "react";
import { fsReadFile } from "../../ipc/commands";

function dirname(relPath: string): string {
  const i = relPath.lastIndexOf("/");
  return i < 0 ? "" : relPath.slice(0, i);
}

function joinPath(dir: string, sub: string): string {
  if (dir === "") return sub;
  return `${dir}/${sub}`;
}

// Desktop-only asset resolver for HTML papers — resolves relative paths in
// `<img src>` / `<source src>` / `<a href>` against the file's project
// directory via Tauri IPC, returning `blob:` URLs that the rendered shadow
// DOM can load. Web has its own OPFS-backed resolver and does not import
// this hook.
export function useAssetResolver(rootId: string, relPath: string): AssetResolver {
  const dir = useMemo(() => dirname(relPath), [relPath]);
  const urlsRef = useRef<Set<string>>(new Set());

  // Revoke the blob URLs we minted whenever the source path changes (which
  // swaps out the rendered DOM) and on unmount. Without this the same paper
  // re-opened repeatedly would leak one URL per asset per open. `rootId` and
  // `relPath` are deliberate re-fire triggers — the body does not read them
  // but a path swap is exactly when we need the cleanup to run.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above.
  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, [rootId, relPath]);

  return useMemo<AssetResolver>(
    () => ({
      async resolve(p: string): Promise<string | null> {
        try {
          const buf = await fsReadFile(rootId, joinPath(dir, p));
          const url = URL.createObjectURL(new Blob([buf]));
          urlsRef.current.add(url);
          return url;
        } catch {
          return null;
        }
      },
    }),
    [rootId, dir],
  );
}
