import type { PaperBuildRow, Repository } from "@obelus/repo";
import { useCallback, useEffect, useState } from "react";

export interface PaperBuildState {
  build: PaperBuildRow | null;
  refresh: () => Promise<void>;
  setMain: (relPath: string | null, pinned: boolean) => Promise<void>;
}

export function usePaperBuild(repo: Repository, paperId: string | null): PaperBuildState {
  const [build, setBuild] = useState<PaperBuildRow | null>(null);

  const refresh = useCallback(async () => {
    if (paperId === null) {
      setBuild(null);
      return;
    }
    const row = await repo.paperBuild.get(paperId);
    setBuild(row ?? null);
  }, [repo, paperId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setMain = useCallback(
    async (relPath: string | null, pinned: boolean) => {
      if (paperId === null) return;
      const next = await repo.paperBuild.setMain(paperId, relPath, pinned);
      setBuild(next);
    },
    [repo, paperId],
  );

  return { build, refresh, setMain };
}
