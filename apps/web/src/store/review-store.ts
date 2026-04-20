import { annotations } from "@obelus/repo/web";
import { createReviewStore } from "@obelus/review-store";

export type { DraftInput, DraftSlice, ReviewState } from "@obelus/review-store";

export const useReviewStore = createReviewStore(annotations);
