import type { JSX } from "react";
import { createContext, type ReactNode, useContext, useEffect, useMemo } from "react";
import { createFindStore, type FindStore } from "../../lib/find-store";
import { useOpenPaper } from "./OpenPaper";

const FindStoreContext = createContext<FindStore | null>(null);

// Provider is paper-scoped: the store resets whenever the open paper changes
// (PDF proxy identity is the cache key inside searchPdfDocument).
export function FindStoreProvider({ children }: { children: ReactNode }): JSX.Element {
  const store = useMemo(() => createFindStore(), []);
  const openPaper = useOpenPaper();
  const doc = openPaper.kind === "ready" ? openPaper.doc : null;

  useEffect(() => {
    store.getState().close();
    store.getState().setDoc(doc);
    return () => {
      store.getState().setDoc(null);
    };
  }, [store, doc]);

  return <FindStoreContext.Provider value={store}>{children}</FindStoreContext.Provider>;
}

export function useFindStore(): FindStore {
  const store = useContext(FindStoreContext);
  if (!store) throw new Error("useFindStore requires FindStoreProvider");
  return store;
}
