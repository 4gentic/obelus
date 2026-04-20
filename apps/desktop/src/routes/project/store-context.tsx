import { createReviewStore, type ReviewState } from "@obelus/review-store";
import type { JSX } from "react";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { StoreApi, UseBoundStore } from "zustand";
import { useProject } from "./context";
export type ReviewStore = UseBoundStore<StoreApi<ReviewState>>;

const ReviewStoreContext = createContext<ReviewStore | null>(null);

export function ReviewStoreProvider({ children }: { children: ReactNode }): JSX.Element {
  const { repo } = useProject();
  const store = useMemo(() => createReviewStore(repo.annotations), [repo]);
  return <ReviewStoreContext.Provider value={store}>{children}</ReviewStoreContext.Provider>;
}

export function useReviewStore(): ReviewStore {
  const store = useContext(ReviewStoreContext);
  if (!store) throw new Error("useReviewStore requires ReviewStoreProvider");
  return store;
}
