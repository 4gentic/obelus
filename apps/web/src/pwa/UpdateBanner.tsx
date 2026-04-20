import { useSyncExternalStore } from "react";
import { applyPwaUpdate, getPwaState, subscribePwa } from "./registerPwa";
import "./UpdateBanner.css";

export default function UpdateBanner() {
  const state = useSyncExternalStore(subscribePwa, getPwaState, getPwaState);

  if (state.error) {
    return (
      <aside className="pwa-banner pwa-banner--error" role="status">
        <span>Service worker did not register: {state.error}</span>
      </aside>
    );
  }

  if (state.needRefresh) {
    return (
      <aside className="pwa-banner" role="status" aria-live="polite">
        <span>A new version is ready.</span>
        <button
          type="button"
          className="pwa-banner__action"
          onClick={() => {
            void applyPwaUpdate();
          }}
        >
          Reload
        </button>
      </aside>
    );
  }

  return null;
}
