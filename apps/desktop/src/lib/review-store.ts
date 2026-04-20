import { createReviewStore, type ReviewState } from "@obelus/review-store";
import type { StoreApi, UseBoundStore } from "zustand";
import { getRepository } from "./repo";

type Store = UseBoundStore<StoreApi<ReviewState>>;

let promise: Promise<Store> | null = null;

export function getReviewStore(): Promise<Store> {
  if (!promise) {
    promise = getRepository().then((repo) => createReviewStore(repo.annotations));
  }
  return promise;
}
