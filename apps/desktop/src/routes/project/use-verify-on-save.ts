import { useEffect, useRef } from "react";
import { useBuffersStore } from "./buffers-store-context";
import { useReviewStore } from "./store-context";
import { verifyMarksAgainstText } from "./verify-source-marks";

// Runs anchor verification for every mark on `relPath` each time the buffer
// is saved to disk. Staleness transitions are written through to the repo
// and mirrored into the review store so the MdReviewSurface sidebar updates
// without a reload. Between saves nothing fires — highlights paint
// optimistically against stored coordinates, as documented in the plan.
export function useVerifyOnSave(relPath: string | null): void {
  const buffers = useBuffersStore();
  const savedAt = buffers((s) => (relPath ? (s.buffers.get(relPath)?.savedAt ?? null) : null));
  const reviewStore = useReviewStore();
  const lastSeenRef = useRef<string | null>(null);

  useEffect(() => {
    if (relPath === null || savedAt === null) return;
    if (lastSeenRef.current === savedAt) return;
    lastSeenRef.current = savedAt;

    // Read the live buffer synchronously. It's the same bytes we just
    // persisted — no disk read needed.
    const entry = buffers.getState().buffers.get(relPath);
    const text = entry?.diskText ?? entry?.text ?? null;
    if (text === null) return;
    const annotations = reviewStore.getState().annotations;
    const patches = verifyMarksAgainstText(relPath, text, annotations);
    if (patches.length === 0) return;
    void reviewStore
      .getState()
      .updateStaleness(patches)
      .then(() => {
        console.info("[mark-verify]", {
          relPath,
          trigger: "save",
          markCount: annotations.length,
          transitions: patches.map((p) => ({ id: p.id, staleness: p.staleness })),
        });
      });
  }, [relPath, savedAt, buffers, reviewStore]);
}
