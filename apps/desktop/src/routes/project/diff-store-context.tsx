import type { JSX } from "react";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { createDiffStore, type DiffStore } from "../../lib/diff-store";
import { useProject } from "./context";

const DiffStoreContext = createContext<DiffStore | null>(null);

export function DiffStoreProvider({ children }: { children: ReactNode }): JSX.Element {
  const { repo } = useProject();
  const store = useMemo(() => createDiffStore(repo.diffHunks), [repo]);
  return <DiffStoreContext.Provider value={store}>{children}</DiffStoreContext.Provider>;
}

export function useDiffStore(): DiffStore {
  const store = useContext(DiffStoreContext);
  if (!store) throw new Error("useDiffStore requires DiffStoreProvider");
  return store;
}
