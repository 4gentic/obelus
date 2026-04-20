import type { JSX } from "react";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { type AskStore, createAskStore } from "../../lib/ask-store";
import { useProject } from "./context";

const AskStoreContext = createContext<AskStore | null>(null);

export function AskStoreProvider({ children }: { children: ReactNode }): JSX.Element {
  const { repo } = useProject();
  const store = useMemo(() => createAskStore(repo.askThreads), [repo]);
  return <AskStoreContext.Provider value={store}>{children}</AskStoreContext.Provider>;
}

export function useAskStore(): AskStore {
  const store = useContext(AskStoreContext);
  if (!store) throw new Error("useAskStore requires AskStoreProvider");
  return store;
}
