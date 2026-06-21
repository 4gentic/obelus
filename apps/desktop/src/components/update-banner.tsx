import { relaunch } from "@tauri-apps/plugin-process";
import type { JSX } from "react";
import { runAutoUpdateCheck, setAutoUpdateConsent } from "../lib/auto-update";
import { formatBytes } from "../lib/format-bytes";
import { useUpdateStore } from "../lib/update-store";
import { downloadAndInstall, type UpdaterState } from "../lib/updater";
import { setDismissedUpdateVersion } from "../store/app-state";
import "./update-banner.css";

function installError(state: UpdaterState | null): string | null {
  if (!state) return null;
  switch (state.kind) {
    case "offline":
      return "Couldn't reach GitHub. Try again when you're online.";
    case "no-release":
      return "No release available right now.";
    case "unconfigured":
      return "The updater isn't configured.";
    case "error":
      return state.message;
    default:
      return null;
  }
}

export default function UpdateBanner(): JSX.Element | null {
  const consent = useUpdateStore((s) => s.consent);
  const available = useUpdateStore((s) => s.available);
  const install = useUpdateStore((s) => s.install);
  const dismissedVersion = useUpdateStore((s) => s.dismissedVersion);
  const setInstall = useUpdateStore((s) => s.setInstall);
  const setDismissed = useUpdateStore((s) => s.setDismissed);

  if (consent === "loading") return null;

  if (consent === "undecided") {
    const onEnable = async (): Promise<void> => {
      await setAutoUpdateConsent(true);
      void runAutoUpdateCheck();
    };
    const onDecline = async (): Promise<void> => {
      await setAutoUpdateConsent(false);
    };
    return (
      <section className="update-banner" aria-label="Update checks">
        <div className="update-banner__main">
          <p className="update-banner__text">
            Let Obelus check for updates when you open it? It asks GitHub for the latest version —
            nothing else leaves your device.
          </p>
        </div>
        <div className="update-banner__actions">
          <button type="button" className="update-banner__btn" onClick={() => void onEnable()}>
            Enable
          </button>
          <button
            type="button"
            className="update-banner__btn update-banner__btn--muted"
            onClick={() => void onDecline()}
          >
            Not now
          </button>
        </div>
      </section>
    );
  }

  if (!available || available.version === dismissedVersion || install?.kind === "installed") {
    return null;
  }

  const downloading = install?.kind === "downloading";
  const errorNote = installError(install);

  const onUpdate = async (): Promise<void> => {
    setInstall({ kind: "downloading", downloaded: 0, total: null });
    const result = await downloadAndInstall((s) => setInstall(s));
    setInstall(result);
    if (result.kind === "installed") await relaunch();
  };
  const onDismiss = async (): Promise<void> => {
    setDismissed(available.version);
    await setDismissedUpdateVersion(available.version);
  };

  return (
    <section
      className="update-banner"
      aria-label="Update available"
      role="status"
      aria-live="polite"
    >
      <div className="update-banner__main">
        <p className="update-banner__text">
          Obelus <span className="update-banner__version">{available.version}</span> is available.
        </p>
        {available.notes ? (
          <details className="update-banner__notes">
            <summary>What's new</summary>
            <pre className="update-banner__notes-body">{available.notes}</pre>
          </details>
        ) : null}
        {install?.kind === "downloading" ? (
          <p className="update-banner__status">
            Downloading {formatBytes(install.downloaded)}
            {install.total !== null ? ` / ${formatBytes(install.total)}` : ""}
          </p>
        ) : null}
        {errorNote ? (
          <p className="update-banner__status update-banner__status--warn">{errorNote}</p>
        ) : null}
      </div>
      <div className="update-banner__actions">
        <button
          type="button"
          className="update-banner__btn"
          disabled={downloading}
          onClick={() => void onUpdate()}
        >
          {downloading ? "Updating…" : "Update now"}
        </button>
        <button
          type="button"
          className="update-banner__btn update-banner__btn--muted"
          onClick={() => void onDismiss()}
        >
          Dismiss
        </button>
      </div>
    </section>
  );
}
