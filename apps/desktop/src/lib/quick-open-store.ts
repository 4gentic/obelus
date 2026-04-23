import { create, type StoreApi, type UseBoundStore } from "zustand";

export interface QuickOpenState {
  isOpen: boolean;
  query: string;
  selectedIndex: number;

  open(): void;
  close(): void;
  setQuery(next: string): void;
  setSelectedIndex(next: number): void;
}

export type QuickOpenStore = UseBoundStore<StoreApi<QuickOpenState>>;

export function createQuickOpenStore(): QuickOpenStore {
  return create<QuickOpenState>()((set) => ({
    isOpen: false,
    query: "",
    selectedIndex: 0,

    open(): void {
      set({ isOpen: true, query: "", selectedIndex: 0 });
    },
    close(): void {
      set({ isOpen: false });
    },
    setQuery(next: string): void {
      set({ query: next, selectedIndex: 0 });
    },
    setSelectedIndex(next: number): void {
      set({ selectedIndex: next });
    },
  }));
}
