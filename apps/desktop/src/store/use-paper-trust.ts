import { useCallback, useEffect, useState } from "react";
import { isPaperTrusted, trustPaper } from "./app-state";

export interface PaperTrust {
  trusted: boolean;
  trust: () => void;
}

// Reads the per-paper external-resource trust flag from `app-state.json`
// and exposes a setter that persists and triggers a local re-render. The
// flag is `false` until the asynchronous initial read resolves, so the
// banner appears with the same default behaviour for trusted and
// not-yet-checked papers — the difference becomes visible once trust is
// granted (the banner disappears, the surface re-renders without CSP).
export function usePaperTrust(paperId: string | null): PaperTrust {
  const [trusted, setTrusted] = useState(false);

  useEffect(() => {
    setTrusted(false);
    if (!paperId) return;
    let cancelled = false;
    void isPaperTrusted(paperId).then((value) => {
      if (!cancelled) setTrusted(value);
    });
    return () => {
      cancelled = true;
    };
  }, [paperId]);

  const trust = useCallback(() => {
    if (!paperId) return;
    void trustPaper(paperId);
    setTrusted(true);
  }, [paperId]);

  return { trusted, trust };
}
