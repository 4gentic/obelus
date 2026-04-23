import type { JSX, ReactNode } from "react";
import { createContext, useContext, useMemo } from "react";
import { createQuickOpenStore, type QuickOpenStore } from "../../lib/quick-open-store";

const QuickOpenStoreContext = createContext<QuickOpenStore | null>(null);

export function QuickOpenStoreProvider({ children }: { children: ReactNode }): JSX.Element {
  const store = useMemo(() => createQuickOpenStore(), []);
  return <QuickOpenStoreContext.Provider value={store}>{children}</QuickOpenStoreContext.Provider>;
}

export function useQuickOpenStore(): QuickOpenStore {
  const store = useContext(QuickOpenStoreContext);
  if (!store) throw new Error("useQuickOpenStore requires QuickOpenStoreProvider");
  return store;
}
