// Per-paper external-resource trust. Mirrors the desktop's `app-state.json`
// `trustedPapers` map; the web persists it in localStorage under a single
// key. Presence in the map means the user has said it's safe to load that
// paper's external resources (images, stylesheets, scripts hosted on remote
// servers). Cleared together with other web state when the user clears
// site data via DevTools.

const STORAGE_KEY = "obelus.trustedPapers";

type TrustedMap = Record<string, true>;

function readMap(): TrustedMap {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw === null || raw === undefined) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return parsed as TrustedMap;
  } catch {
    return {};
  }
}

export function isPaperTrusted(paperId: string): boolean {
  return readMap()[paperId] === true;
}

export function trustPaper(paperId: string): void {
  const map = readMap();
  if (map[paperId] === true) return;
  map[paperId] = true;
  globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(map));
}
