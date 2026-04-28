import { getVersion } from "@tauri-apps/api/app";
import { ask } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { useCallback, useEffect, useState } from "react";
import AiEngineMissing from "../components/ai-engine-missing";
import EngineBlock from "../components/engine-block";
import { useAiEngine } from "../hooks/use-ai-engine";
import { ACTIVE_AI_ENGINE, aiEngineLabel } from "../lib/ai-engine";
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
  const engine = useAiEngine();
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState<"wizard" | "factory" | null>(null);
  const [updater, setUpdater] = useState<UpdaterState>({ kind: "idle" });
  const [version, setVersion] = useState<string | null>(null);

  const recheck = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      await engine.recheck();
    } finally {
      setBusy(false);
    }
  }, [engine]);

  useEffect(() => {
    void getVersion()
      .then(setVersion)
      .catch((err: unknown) => {
        console.error("[settings] getVersion failed", err);
      });
  }, []);

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
      "Factory reset erases everything Obelus has stored on this device — every desk, project, paper, annotation, review session, write-up, and pinned file. Source files on disk are untouched. This cannot be undone. Continue?",
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
        <h2 className="settings__block-title">{aiEngineLabel(ACTIVE_AI_ENGINE)}</h2>
        {engine.status === "checking" ? (
          <p className="settings__body">Looking.</p>
        ) : engine.status.raw.status === "found" ? (
          <pre className="settings__pane">
            {`path     ${engine.status.raw.path ?? "—"}\nversion  ${engine.status.raw.version ?? "—"}`}
          </pre>
        ) : (
          <div className="settings__pane settings__pane--warn">
            <pre>{`status   ${engine.status.raw.status}\nfloor    ${engine.status.raw.floor}`}</pre>
            <div className="settings__pane-extras">
              <AiEngineMissing
                engine={engine.status.engine}
                hostOs={engine.status.hostOs}
                lead={
                  engine.status.raw.status === "notFound"
                    ? `${aiEngineLabel(engine.status.engine)} is not installed on this machine.`
                    : `${aiEngineLabel(engine.status.engine)} is installed but not at a version Obelus accepts.`
                }
              />
            </div>
          </div>
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
        <h2 className="settings__block-title">Compile engines</h2>
        <p className="settings__body">
          Install a compile engine managed by Obelus, or rely on a system-installed one. Obelus
          prefers a managed install so paper rendering doesn't depend on what's on your PATH.
        </p>
        <EngineBlock engine="typst" />
        <EngineBlock engine="tectonic" />
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
        {updater.kind === "no-release" ? (
          <pre className="settings__pane">No release published yet. Check back shortly.</pre>
        ) : null}
        {updater.kind === "offline" ? (
          <pre className="settings__pane settings__pane--warn">
            Could not reach GitHub. Obelus stays offline; try again when you're online.
          </pre>
        ) : null}
        {updater.kind === "unconfigured" ? (
          <pre className="settings__pane settings__pane--warn">
            Updater not configured. Embed a minisign public key in tauri.conf.json.
          </pre>
        ) : null}
        {updater.kind === "error" ? (
          <div className="settings__pane settings__pane--warn">
            {updater.message}
            <details className="settings__details">
              <summary>Details</summary>
              <pre className="settings__raw">{updater.raw}</pre>
            </details>
          </div>
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
          Wipes everything Obelus has stored on this device — desks, projects, papers, annotations,
          review sessions, write-ups, and pinned files — and re-runs the wizard. Source files on
          disk are untouched. This cannot be undone.
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

      <article className="settings__block">
        <h2 className="settings__block-title">About</h2>
        <pre className="settings__pane">
          {`version  ${version ?? "—"}\nbuild    ${import.meta.env.DEV ? "dev" : "release"}`}
        </pre>
        <p className="settings__body">
          An imprint of{" "}
          <a
            href="https://4gentic.ai"
            onClick={(e) => {
              e.preventDefault();
              void openExternal("https://4gentic.ai");
            }}
          >
            4gentic
          </a>
          .
        </p>
      </article>
    </section>
  );
}
