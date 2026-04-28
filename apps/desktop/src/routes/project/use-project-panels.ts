import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getProjectPanelState,
  type ProjectPanelState,
  setProjectPanelHidden,
} from "../../store/app-state";

export interface ProjectPanels {
  filesHidden: boolean;
  reviewHidden: boolean;
  toggleFiles(): void;
  toggleReview(): void;
  showReview(): void;
}

const DEFAULTS: ProjectPanelState = { filesHidden: false, reviewHidden: false };

// Hydrates from `app-state.json` once per project. The first paint uses
// defaults (both panels visible) — flicker only matters if a user shipped a
// project with both panels hidden, in which case they'll see one frame of
// the visible state. Acceptable for a desktop preference; we don't block
// render on the async load.
export function useProjectPanels(projectId: string): ProjectPanels {
  const [state, setState] = useState<ProjectPanelState>(DEFAULTS);
  // If the user toggles before the async hydration resolves, the hydrated
  // value would otherwise clobber the click. dirtyRef gates that.
  const dirtyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    dirtyRef.current = false;
    void (async () => {
      const loaded = await getProjectPanelState(projectId);
      if (cancelled || dirtyRef.current) return;
      setState(loaded ?? DEFAULTS);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const toggleFiles = useCallback(() => {
    dirtyRef.current = true;
    setState((prev) => {
      const next = { ...prev, filesHidden: !prev.filesHidden };
      void setProjectPanelHidden(projectId, "files", next.filesHidden);
      return next;
    });
  }, [projectId]);

  const toggleReview = useCallback(() => {
    dirtyRef.current = true;
    setState((prev) => {
      const next = { ...prev, reviewHidden: !prev.reviewHidden };
      void setProjectPanelHidden(projectId, "review", next.reviewHidden);
      return next;
    });
  }, [projectId]);

  const showReview = useCallback(() => {
    setState((prev) => {
      if (!prev.reviewHidden) return prev;
      dirtyRef.current = true;
      void setProjectPanelHidden(projectId, "review", false);
      return { ...prev, reviewHidden: false };
    });
  }, [projectId]);

  return useMemo(
    () => ({
      filesHidden: state.filesHidden,
      reviewHidden: state.reviewHidden,
      toggleFiles,
      toggleReview,
      showReview,
    }),
    [state.filesHidden, state.reviewHidden, toggleFiles, toggleReview, showReview],
  );
}
