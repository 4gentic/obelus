import { ask } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { useEffect, useState } from "react";
import { readClaudeStatus } from "../boot/detect";
import type { ClaudeStatus } from "../ipc/commands";
import { factoryReset, wizardReset } from "../lib/reset";
import { checkForUpdate, downloadAndInstall, type UpdaterState } from "../lib/updater";
import "./settings.css";

import type { JSX } from "react";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Settings(): JSX.Element {
  const [claude, setClaude] = useState<ClaudeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState<"wizard" | "factory" | null>(null);
  const [updater, setUpdater] = useState<UpdaterState>({ kind: "idle" });

  useEffect(() => {
    void (async () => {
      setClaude(await readClaudeStatus());
    })();
  }, []);

  async function recheck(): Promise<void> {
    setBusy(true);
    const next = await readClaudeStatus(true);
    setClaude(next);
    setBusy(false);
  }

  async function onWizardReset(): Promise<void> {
    const ok = await ask(
      "Reset wizard clears the wizard checkpoint and Claude-detect cache, then re-runs the wizard. Your projects and annotations stay. Continue?",
      { title: "Reset wizard", kind: "info", okLabel: "Reset wizard", cancelLabel: "Cancel" },
    );
    if (!ok) return;
    setResetting("wizard");
    await wizardReset();
    window.location.hash = "/wizard";
    window.location.reload();
  }

  async function onCheckUpdate(): Promise<void> {
    setUpdater({ kind: "checking" });
    setUpdater(await checkForUpdate());
  }

  async function onInstallUpdate(): Promise<void> {
    const result = await downloadAndInstall(setUpdater);
    setUpdater(result);
    if (result.kind === "installed") await relaunch();
  }

  async function onFactoryReset(): Promise<void> {
    const ok = await ask(
      "Factory reset erases every project, paper, annotation, review, and write-up. This cannot be undone. Continue?",
      {
        title: "Factory reset",
        kind: "warning",
        okLabel: "Factory reset",
        cancelLabel: "Cancel",
      },
    );
    if (!ok) return;
    setResetting("factory");
    await factoryReset();
    window.location.hash = "/wizard";
    window.location.reload();
  }

  return (
    <section className="settings">
      <header className="settings__header">
        <h1 className="settings__title">Settings.</h1>
        <p className="settings__sub">What Obelus knows about your machine.</p>
      </header>

      <article className="settings__block">
        <h2 className="settings__block-title">Claude Code</h2>
        {claude === null ? (
          <p className="settings__body">Looking.</p>
        ) : claude.status === "found" ? (
          <pre className="settings__pane">
            {`path     ${claude.path ?? "—"}\nversion  ${claude.version ?? "—"}`}
          </pre>
        ) : (
          <pre className="settings__pane settings__pane--warn">
            {`status   ${claude.status}\nfloor    ${claude.floor}`}
          </pre>
        )}
        <button
          type="button"
          className="settings__button"
          onClick={() => void recheck()}
          disabled={busy}
        >
          {busy ? "Checking." : "Check again"}
        </button>
      </article>

      <article className="settings__block">
        <h2 className="settings__block-title">Updates</h2>
        <p className="settings__body">
          Checks GitHub Releases for a newer signed build. Obelus only installs updates whose
          manifest verifies against the embedded public key.
        </p>
        {updater.kind === "available" ? (
          <pre className="settings__pane">
            {`new      ${updater.version}${updater.notes ? `\n\n${updater.notes}` : ""}`}
          </pre>
        ) : null}
        {updater.kind === "downloading" ? (
          <pre className="settings__pane">
            {`downloading  ${formatBytes(updater.downloaded)}${updater.total !== null ? ` / ${formatBytes(updater.total)}` : ""}`}
          </pre>
        ) : null}
        {updater.kind === "current" ? <pre className="settings__pane">Up to date.</pre> : null}
        {updater.kind === "unconfigured" ? (
          <pre className="settings__pane settings__pane--warn">
            Updater not configured. Embed a minisign public key in tauri.conf.json.
          </pre>
        ) : null}
        {updater.kind === "error" ? (
          <pre className="settings__pane settings__pane--warn">{updater.message}</pre>
        ) : null}
        {updater.kind === "available" ? (
          <button type="button" className="settings__button" onClick={() => void onInstallUpdate()}>
            Download and install
          </button>
        ) : (
          <button
            type="button"
            className="settings__button"
            onClick={() => void onCheckUpdate()}
            disabled={updater.kind === "checking" || updater.kind === "downloading"}
          >
            {updater.kind === "checking" ? "Checking." : "Check for updates"}
          </button>
        )}
      </article>

      <article className="settings__block">
        <h2 className="settings__block-title">Reset wizard</h2>
        <p className="settings__body">
          Clears the wizard checkpoint and the Claude-detect cache, then re-runs the wizard. Your
          projects and annotations stay.
        </p>
        <button
          type="button"
          className="settings__button"
          onClick={() => void onWizardReset()}
          disabled={resetting !== null}
        >
          {resetting === "wizard" ? "Resetting." : "Reset wizard"}
        </button>
      </article>

      <article className="settings__block">
        <h2 className="settings__block-title">Factory reset</h2>
        <p className="settings__body">
          Wipes every project, paper, annotation, review session, and write-up on this device, and
          re-runs the wizard. Source files on disk are untouched. This cannot be undone.
        </p>
        <button
          type="button"
          className="settings__button settings__button--warn"
          onClick={() => void onFactoryReset()}
          disabled={resetting !== null}
        >
          {resetting === "factory" ? "Wiping." : "Factory reset"}
        </button>
      </article>
    </section>
  );
}
