import { ask } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { useEffect, useState } from "react";
import { readClaudeStatus } from "../boot/detect";
import type { ClaudeStatus } from "../ipc/commands";
import { factoryReset, wizardReset } from "../lib/reset";
import { checkForUpdate, downloadAndInstall, type UpdaterState } from "../lib/updater";
import {
  type ClaudeEffortChoice,
  type ClaudeModelChoice,
  EFFORT_CHOICES,
  MODEL_CHOICES,
  useClaudeConfig,
} from "../lib/use-claude-defaults";
import "./settings.css";

import type { ChangeEvent, JSX } from "react";

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

      <ClaudeConfigBlock />

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

const MODEL_LABELS: Record<Exclude<ClaudeModelChoice, null>, string> = {
  opus: "Opus 4.7",
  sonnet: "Sonnet 4.6",
  haiku: "Haiku 4.5",
};

const EFFORT_LABELS: Record<Exclude<ClaudeEffortChoice, null>, string> = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

function ClaudeConfigBlock(): JSX.Element {
  const cfg = useClaudeConfig();
  const defaultModel = cfg.defaults?.model ?? "—";
  const defaultEffort = cfg.defaults?.effortLevel ?? "—";

  function onModelChange(e: ChangeEvent<HTMLSelectElement>): void {
    const v = e.target.value;
    void cfg.setModel(v === "" ? null : (v as Exclude<ClaudeModelChoice, null>));
  }

  function onEffortChange(e: ChangeEvent<HTMLSelectElement>): void {
    const v = e.target.value;
    void cfg.setEffort(v === "" ? null : (v as Exclude<ClaudeEffortChoice, null>));
  }

  return (
    <article className="settings__block">
      <h2 className="settings__block-title">Claude</h2>
      <p className="settings__body">
        Choose the model and reasoning effort Obelus asks Claude Code to use. Leaving a field on{" "}
        <em>Follow Claude Code</em> inherits whatever you set via <code>/model</code> or in{" "}
        <code>~/.claude/settings.json</code>.
      </p>
      <div className="settings__fields">
        <label className="settings__field">
          <span className="settings__field-label">Model</span>
          <select
            className="settings__select"
            value={cfg.model ?? ""}
            onChange={onModelChange}
            disabled={!cfg.loaded}
          >
            <option value="">Follow Claude Code</option>
            {MODEL_CHOICES.map((m) => (
              <option key={m} value={m}>
                {MODEL_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
        <label className="settings__field">
          <span className="settings__field-label">Effort</span>
          <select
            className="settings__select"
            value={cfg.effort ?? ""}
            onChange={onEffortChange}
            disabled={!cfg.loaded}
          >
            <option value="">Follow Claude Code</option>
            {EFFORT_CHOICES.map((e) => (
              <option key={e} value={e}>
                {EFFORT_LABELS[e]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <pre className="settings__pane">
        {`claude code default   ${defaultModel} · ${defaultEffort}`}
      </pre>
    </article>
  );
}
