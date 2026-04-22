import type { ProjectBuildRow, Repository } from "@obelus/repo";
import { useCallback, useEffect, useState } from "react";

export interface ProjectBuildState {
  build: ProjectBuildRow | null;
  refresh: () => Promise<void>;
  setMain: (relPath: string | null, pinned: boolean) => Promise<void>;
}

export function useProjectBuild(repo: Repository, projectId: string): ProjectBuildState {
  const [build, setBuild] = useState<ProjectBuildRow | null>(null);

  const refresh = useCallback(async () => {
    const row = await repo.projectBuild.get(projectId);
    setBuild(row ?? null);
  }, [repo, projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setMain = useCallback(
    async (relPath: string | null, pinned: boolean) => {
      const next = await repo.projectBuild.setMain(projectId, relPath, pinned);
      setBuild(next);
    },
    [repo, projectId],
  );

  return { build, refresh, setMain };
}
