import type { Anchor, Bbox } from "@obelus/anchor";
import type { SourceAnchor2 } from "@obelus/bundle-schema";
import type {
  AnnotationRow,
  AnnotationStaleness,
  AnnotationStalenessPatch,
  AnnotationsRepo,
} from "@obelus/repo";

type Category = string;

import type { StoreApi } from "zustand";
import { create, type UseBoundStore } from "zustand";

// PDF-anchored draft slice. `kind` is optional so existing callers that never
// stamped a discriminator keep working; absence narrows to PDF.
export type PdfDraftSlice = {
  kind?: "pdf";
  anchor: Anchor;
  quote: string;
  contextBefore: string;
  contextAfter: string;
  bbox: Bbox;
  rects: Bbox[];
};

export type SourceDraftSlice = {
  kind: "source";
  anchor: SourceAnchor2;
  quote: string;
  contextBefore: string;
  contextAfter: string;
};

export type DraftSlice = PdfDraftSlice | SourceDraftSlice;

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
  load: (revisionId: string, visibleFromEditId?: string) => Promise<void>;
  // Clears everything paper-scoped in the store. Called when the open paper
  // has no revision yet (writer-mode MD pre-first-save, or the no-paper
  // state between file switches) so a stale `revisionId` from a previously
  // open paper doesn't leak into the next save.
  reset: () => void;
  setSelectedAnchor: (draft: DraftInput | null) => void;
  setDraftCategory: (category: Category | null) => void;
  setDraftNote: (note: string) => void;
  setFocusedAnnotation: (id: string | null) => void;
  saveAnnotation: (input: {
    draft: DraftInput;
    category: Category;
    note: string;
    // Optional lazy-revision resolver. When the store has no revisionId yet
    // (writer-mode MD that hasn't been ingested as a paper), this callback
    // materializes one — typically by creating a PaperRow + RevisionRow. The
    // returned id is stored and used for the bulkPut that follows.
    ensureRevision?: () => Promise<string>;
  }) => Promise<void>;
  updateAnnotation: (id: string, patch: Partial<AnnotationRow>) => Promise<void>;
  deleteAnnotation: (id: string) => Promise<void>;
  deleteGroup: (groupId: string) => Promise<void>;
  // Persists staleness patches and mirrors them into the in-memory
  // annotations list so the UI re-renders without a full reload. Rows in
  // `patches` that aren't currently in the store are ignored in-memory but
  // still written to storage.
  updateStaleness: (patches: ReadonlyArray<AnnotationStalenessPatch>) => Promise<void>;
};

function uuid(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createReviewStore(repo: AnnotationsRepo): UseBoundStore<StoreApi<ReviewState>> {
  return create<ReviewState>()((set, get) => ({
    revisionId: null,
    annotations: [],
    selectedAnchor: null,
    draftCategory: null,
    draftNote: "",
    focusedAnnotationId: null,

    async load(revisionId, visibleFromEditId) {
      const rows = await repo.listForRevision(
        revisionId,
        visibleFromEditId !== undefined ? { visibleFromEditId } : undefined,
      );
      set({
        revisionId,
        annotations: rows,
        selectedAnchor: null,
        draftCategory: null,
        draftNote: "",
        focusedAnnotationId: null,
      });
    },

    reset() {
      set({
        revisionId: null,
        annotations: [],
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

    async saveAnnotation({ draft, category, note, ensureRevision }) {
      let revisionId = get().revisionId;
      if (!revisionId) {
        if (!ensureRevision) {
          console.warn("[save-mark]", {
            outcome: "no-revision-and-no-ensureRevision",
            category,
            sliceCount: draft.slices.length,
          });
          return;
        }
        revisionId = await ensureRevision();
        set({ revisionId });
      }
      const createdAt = nowIso();
      const groupId = draft.slices.length > 1 ? uuid() : undefined;
      const rows: AnnotationRow[] = draft.slices.map((slice) => {
        if (slice.kind === "source") {
          return {
            id: uuid(),
            revisionId,
            category,
            quote: slice.quote,
            contextBefore: slice.contextBefore,
            contextAfter: slice.contextAfter,
            anchor: {
              kind: "source",
              file: slice.anchor.file,
              lineStart: slice.anchor.lineStart,
              colStart: slice.anchor.colStart,
              lineEnd: slice.anchor.lineEnd,
              colEnd: slice.anchor.colEnd,
            },
            note,
            thread: [],
            createdAt,
            ...(groupId ? { groupId } : {}),
          };
        }
        return {
          id: uuid(),
          revisionId,
          category,
          quote: slice.quote,
          contextBefore: slice.contextBefore,
          contextAfter: slice.contextAfter,
          anchor: {
            kind: "pdf",
            page: slice.anchor.pageIndex + 1,
            bbox: [slice.bbox[0], slice.bbox[1], slice.bbox[2], slice.bbox[3]],
            rects: slice.rects.map((r) => [r[0], r[1], r[2], r[3]]),
            textItemRange: {
              start: [slice.anchor.startItem, slice.anchor.startOffset],
              end: [slice.anchor.endItem, slice.anchor.endOffset],
            },
          },
          note,
          thread: [],
          createdAt,
          ...(groupId ? { groupId } : {}),
        };
      });
      console.info("[save-mark/pre-persist]", {
        revisionId,
        rowCount: rows.length,
        ids: rows.map((r) => r.id),
        kind: rows[0]?.anchor.kind,
      });
      await repo.bulkPut(revisionId, rows);
      const firstRow = rows[0];
      console.info("[save-mark]", {
        revisionId,
        rowCount: rows.length,
        category,
        kind: firstRow?.anchor.kind,
        ...(groupId ? { groupId } : {}),
      });
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
      if (current.resolvedInEditId !== undefined) return;

      const next: AnnotationRow = { ...current, ...patch, id, revisionId };

      const mirrored: Partial<Pick<AnnotationRow, "note" | "category">> = {};
      if (patch.note !== undefined) mirrored.note = patch.note;
      if (patch.category !== undefined) mirrored.category = patch.category;

      if (current.groupId && Object.keys(mirrored).length > 0) {
        const groupId = current.groupId;
        const siblings = get().annotations.filter((a) => a.groupId === groupId);
        const updatedSiblings = siblings.map((s) => ({ ...s, ...mirrored }));
        await repo.bulkPut(revisionId, updatedSiblings);
        set({
          annotations: get().annotations.map((a) =>
            a.groupId === groupId ? { ...a, ...mirrored } : a,
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

    async updateStaleness(patches) {
      if (patches.length === 0) return;
      await repo.setStaleness(patches);
      const byId = new Map<string, AnnotationStaleness>(patches.map((p) => [p.id, p.staleness]));
      set({
        annotations: get().annotations.map((a) => {
          const s = byId.get(a.id);
          return s !== undefined ? { ...a, staleness: s } : a;
        }),
      });
    },
  }));
}
