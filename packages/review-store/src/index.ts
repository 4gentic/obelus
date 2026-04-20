import type { Anchor, Bbox } from "@obelus/anchor";
import type { AnnotationRow, AnnotationsRepo } from "@obelus/repo";

type Category = string;

import { temporal } from "zundo";
import type { StoreApi } from "zustand";
import { create, type UseBoundStore } from "zustand";

export type DraftSlice = {
  anchor: Anchor;
  quote: string;
  contextBefore: string;
  contextAfter: string;
  bbox: Bbox;
  rects: Bbox[];
};

export type DraftInput = {
  slices: DraftSlice[];
  quote: string;
  contextBefore: string;
  contextAfter: string;
};

export type ReviewState = {
  revisionId: string | null;
  annotations: AnnotationRow[];
  selectedAnchor: DraftInput | null;
  draftCategory: Category | null;
  draftNote: string;
  focusedAnnotationId: string | null;
  load: (revisionId: string) => Promise<void>;
  setSelectedAnchor: (draft: DraftInput | null) => void;
  setDraftCategory: (category: Category | null) => void;
  setDraftNote: (note: string) => void;
  setFocusedAnnotation: (id: string | null) => void;
  saveAnnotation: (input: { draft: DraftInput; category: Category; note: string }) => Promise<void>;
  updateAnnotation: (id: string, patch: Partial<AnnotationRow>) => Promise<void>;
  deleteAnnotation: (id: string) => Promise<void>;
  deleteGroup: (groupId: string) => Promise<void>;
};

function uuid(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createReviewStore(repo: AnnotationsRepo): UseBoundStore<StoreApi<ReviewState>> {
  return create<ReviewState>()(
    temporal((set, get) => ({
      revisionId: null,
      annotations: [],
      selectedAnchor: null,
      draftCategory: null,
      draftNote: "",
      focusedAnnotationId: null,

      async load(revisionId) {
        const rows = await repo.listForRevision(revisionId);
        set({
          revisionId,
          annotations: rows,
          selectedAnchor: null,
          draftCategory: null,
          draftNote: "",
          focusedAnnotationId: null,
        });
      },

      setSelectedAnchor(draft) {
        if (draft === null) {
          set({ selectedAnchor: null, draftCategory: null, draftNote: "" });
          return;
        }
        set({ selectedAnchor: draft, draftCategory: null, draftNote: "" });
      },

      setDraftCategory(category) {
        set({ draftCategory: category });
      },

      setDraftNote(note) {
        set({ draftNote: note });
      },

      setFocusedAnnotation(id) {
        set({ focusedAnnotationId: id });
      },

      async saveAnnotation({ draft, category, note }) {
        const revisionId = get().revisionId;
        if (!revisionId) return;
        const createdAt = nowIso();
        const groupId = draft.slices.length > 1 ? uuid() : undefined;
        const rows: AnnotationRow[] = draft.slices.map((slice) => ({
          id: uuid(),
          revisionId,
          category,
          quote: slice.quote,
          contextBefore: slice.contextBefore,
          contextAfter: slice.contextAfter,
          page: slice.anchor.pageIndex + 1,
          bbox: [slice.bbox[0], slice.bbox[1], slice.bbox[2], slice.bbox[3]],
          rects: slice.rects.map((r) => [r[0], r[1], r[2], r[3]]),
          textItemRange: {
            start: [slice.anchor.startItem, slice.anchor.startOffset],
            end: [slice.anchor.endItem, slice.anchor.endOffset],
          },
          note,
          thread: [],
          createdAt,
          ...(groupId ? { groupId } : {}),
        }));
        await repo.bulkPut(revisionId, rows);
        set({
          annotations: [...get().annotations, ...rows],
          selectedAnchor: null,
          draftCategory: null,
          draftNote: "",
        });
      },

      async updateAnnotation(id, patch) {
        const revisionId = get().revisionId;
        if (!revisionId) return;
        const current = get().annotations.find((a) => a.id === id);
        if (!current) return;
        const next: AnnotationRow = { ...current, ...patch, id, revisionId };
        if (patch.note !== undefined && current.groupId) {
          const groupId = current.groupId;
          const siblings = get().annotations.filter((a) => a.groupId === groupId);
          const mirrored = siblings.map((s) => ({ ...s, note: patch.note ?? "" }));
          await repo.bulkPut(revisionId, mirrored);
          set({
            annotations: get().annotations.map((a) =>
              a.groupId === groupId ? { ...a, note: patch.note ?? "" } : a,
            ),
          });
          return;
        }
        await repo.bulkPut(revisionId, [next]);
        set({
          annotations: get().annotations.map((a) => (a.id === id ? next : a)),
        });
      },

      async deleteAnnotation(id) {
        await repo.remove(id);
        set({
          annotations: get().annotations.filter((a) => a.id !== id),
          focusedAnnotationId: get().focusedAnnotationId === id ? null : get().focusedAnnotationId,
        });
      },

      async deleteGroup(groupId) {
        const victims = get().annotations.filter((a) => a.groupId === groupId);
        for (const v of victims) {
          await repo.remove(v.id);
        }
        set({
          annotations: get().annotations.filter((a) => a.groupId !== groupId),
        });
      },
    })),
  );
}
