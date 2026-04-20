import type { ProjectRow, Repository } from "@obelus/repo";
import type { JSX } from "react";
import { createContext, type ReactNode, useContext } from "react";
export interface ProjectContextValue {
  project: ProjectRow;
  rootId: string;
  repo: Repository;
  openFilePath: string | null;
  setOpenFilePath: (path: string | null) => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({
  value,
  children,
}: {
  value: ProjectContextValue;
  children: ReactNode;
}): JSX.Element {
  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used inside ProjectProvider");
  return ctx;
}
