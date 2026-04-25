import { useCallback, useEffect, useState } from "react";
import { isPaperTrusted, trustPaper } from "./trusted-papers";

export interface PaperTrust {
  trusted: boolean;
  trust: () => void;
}

// React hook for the localStorage-backed trust map. Reads synchronously on
// mount; the setter persists and triggers a local re-render so the surface
// can flip its `trusted` prop without a route change.
export function usePaperTrust(paperId: string | null): PaperTrust {
  const [trusted, setTrusted] = useState<boolean>(() =>
    paperId ? isPaperTrusted(paperId) : false,
  );

  useEffect(() => {
    if (!paperId) {
      setTrusted(false);
      return;
    }
    setTrusted(isPaperTrusted(paperId));
  }, [paperId]);

  const trust = useCallback(() => {
    if (!paperId) return;
    trustPaper(paperId);
    setTrusted(true);
  }, [paperId]);

  return { trusted, trust };
}
