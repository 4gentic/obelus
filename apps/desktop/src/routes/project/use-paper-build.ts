import type { PaperBuildRow, Repository } from "@obelus/repo";
import { useCallback, useEffect, useState } from "react";

export interface PaperBuildState {
  build: PaperBuildRow | null;
  refresh: () => Promise<void>;
  setMain: (relPath: string | null, pinned: boolean) => Promise<void>;
}

// Cross-instance change bus. Multiple components (FilesColumn, the review
// footer, the compile pane) read paperBuild via independent hook instances;
// when the user toggles ★ on a row, every observer must see the new mainRelPath
// without a tab/route trip. Each `setMain` notifies the bus; subscribers re-read.
const changeBus = new EventTarget();

function notifyChange(paperId: string): void {
  changeBus.dispatchEvent(new CustomEvent<string>("change", { detail: paperId }));
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

  useEffect(() => {
    if (paperId === null) return;
    const listener = (ev: Event): void => {
      const detail = (ev as CustomEvent<string>).detail;
      if (detail === paperId) void refresh();
    };
    changeBus.addEventListener("change", listener);
    return () => changeBus.removeEventListener("change", listener);
  }, [paperId, refresh]);

  const setMain = useCallback(
    async (relPath: string | null, pinned: boolean) => {
      if (paperId === null) return;
      const next = await repo.paperBuild.setMain(paperId, relPath, pinned);
      setBuild(next);
      notifyChange(paperId);
    },
    [repo, paperId],
  );

  return { build, refresh, setMain };
}
