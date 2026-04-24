import type { JSX } from "react";
import { createContext, type ReactNode, useContext, useEffect, useMemo } from "react";
import { type BuffersStore, createBuffersStore } from "../../lib/buffers-store";
import { setActiveBuffersStore } from "./active-buffers-store";
import { useProject } from "./context";

const BuffersStoreContext = createContext<BuffersStore | null>(null);

export function BuffersStoreProvider({ children }: { children: ReactNode }): JSX.Element {
  const { rootId } = useProject();
  const store = useMemo(() => createBuffersStore(rootId), [rootId]);
  useEffect(() => {
    setActiveBuffersStore(store);
    return () => {
      setActiveBuffersStore(null);
    };
  }, [store]);
  return <BuffersStoreContext.Provider value={store}>{children}</BuffersStoreContext.Provider>;
}

export function useBuffersStore(): BuffersStore {
  const store = useContext(BuffersStoreContext);
  if (!store) throw new Error("useBuffersStore requires BuffersStoreProvider");
  return store;
}
