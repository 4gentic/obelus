import { ask } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import type { JSX } from "react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { nextDestination } from "../boot/restore";
import { resetLocalState } from "../ipc/commands";
import "./boot.css";

export default function Boot(): JSX.Element {
  const navigate = useNavigate();
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const dest = await nextDestination();
        if (!cancelled) navigate(dest, { replace: true });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (error) return <BootError error={error} />;
  return <div className="boot" aria-hidden="true" />;
}

type WipeStatus = "idle" | "confirming" | "working" | "failed";

// Keep these paths in sync with the targets in `src-tauri/src/commands/reset_local_state.rs`.
// The Rust side derives the directory from Tauri's `app_data_dir()`; this list mirrors what
// that resolves to per OS so users can recover by hand if the IPC call itself fails.
const MANUAL_COMMANDS: ReadonlyArray<{ os: string; command: string }> = [
  {
    os: "macOS",
    command: [
      "rm -f ~/Library/Application\\ Support/app.obelus.desktop/obelus.db*",
      "rm -f ~/Library/Application\\ Support/app.obelus.desktop/app-state.json",
      "rm -rf ~/Library/Application\\ Support/app.obelus.desktop/projects",
    ].join("\n"),
  },
  {
    os: "Linux",
    command: [
      "rm -f ~/.local/share/app.obelus.desktop/obelus.db*",
      "rm -f ~/.local/share/app.obelus.desktop/app-state.json",
      "rm -rf ~/.local/share/app.obelus.desktop/projects",
    ].join("\n"),
  },
  {
    os: "Windows (PowerShell)",
    command: [
      'Remove-Item "$env:APPDATA\\app.obelus.desktop\\obelus.db*" -ErrorAction SilentlyContinue',
      'Remove-Item "$env:APPDATA\\app.obelus.desktop\\app-state.json" -ErrorAction SilentlyContinue',
      'Remove-Item "$env:APPDATA\\app.obelus.desktop\\projects" -Recurse -ErrorAction SilentlyContinue',
    ].join("\n"),
  },
];

function BootError({ error }: { error: Error }): JSX.Element {
  const [status, setStatus] = useState<WipeStatus>("idle");
  const [wipeError, setWipeError] = useState<string | null>(null);

  const onWipe = async (): Promise<void> => {
    setStatus("confirming");
    const confirmed = await ask(
      "This deletes the local Obelus database and UI state, then relaunches. Project files on disk are not touched. Continue?",
      { title: "Wipe local state", kind: "warning", okLabel: "Wipe and relaunch" },
    );
    if (!confirmed) {
      setStatus("idle");
      return;
    }
    setStatus("working");
    setWipeError(null);
    try {
      await resetLocalState();
      await relaunch();
    } catch (err) {
      setStatus("failed");
      setWipeError(err instanceof Error ? err.message : String(err));
    }
  };

  const busy = status === "confirming" || status === "working";

  return (
    <section className="boot-error" role="alert">
      <article className="boot-error__plate">
        <p className="boot-error__eyebrow">Boot halted</p>
        <h1 className="boot-error__title">The project store could not be opened.</h1>
        <p className="boot-error__lede">
          A database migration failed while starting Obelus. The app is still pre-release, so the
          recommended recovery is to wipe local state and relaunch. Project files on disk are not
          touched — only Obelus's own database and UI state.
        </p>

        <div className="boot-error__actions">
          <button
            type="button"
            className="boot-error__retry"
            onClick={() => {
              void onWipe();
            }}
            disabled={busy}
          >
            {status === "working" ? "Wiping…" : "Wipe local state and relaunch"}
          </button>
          <button
            type="button"
            className="boot-error__reload"
            onClick={() => {
              window.location.reload();
            }}
            disabled={busy}
          >
            Reload only
          </button>
        </div>

        {wipeError ? (
          <p className="boot-error__wipe-error">Could not wipe automatically: {wipeError}</p>
        ) : null}

        <details className="boot-error__details">
          <summary>Do it manually</summary>
          <div className="boot-error__manual">
            {MANUAL_COMMANDS.map(({ os, command }) => (
              <div key={os} className="boot-error__manual-row">
                <p className="boot-error__manual-os">{os}</p>
                <pre className="boot-error__code">
                  <code>{command}</code>
                </pre>
              </div>
            ))}
          </div>
        </details>

        <details className="boot-error__details">
          <summary>Error detail</summary>
          <pre className="boot-error__trace">
            <code>{error.message}</code>
          </pre>
        </details>
      </article>
    </section>
  );
}
