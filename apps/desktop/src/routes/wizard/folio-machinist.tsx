import { type JSX, useEffect } from "react";
import AiEngineMissing from "../../components/ai-engine-missing";
import {
  type AiEngineId,
  type AiEngineStatus,
  aiEngineLabel,
  aiEngineSignInHint,
  type ClaudeCodeEngineStatus,
  type OpenCodeEngineStatus,
} from "../../lib/ai-engine";

interface Props {
  claudeCode: ClaudeCodeEngineStatus | "checking";
  openCode: OpenCodeEngineStatus | "checking";
  preferred: AiEngineId | null;
  setPreferred: (id: AiEngineId) => Promise<void>;
  onRecheck: () => void;
  onAdvance: () => void;
}

function isReady(s: AiEngineStatus | "checking"): s is AiEngineStatus {
  return s !== "checking" && s.ready;
}

export default function FolioMachinist({
  claudeCode,
  openCode,
  preferred,
  setPreferred,
  onRecheck,
  onAdvance,
}: Props): JSX.Element {
  const checking = claudeCode === "checking" || openCode === "checking";
  const claudeReady = isReady(claudeCode);
  const openCodeReady = isReady(openCode);
  const anyReady = claudeReady || openCodeReady;
  const stranded = !checking && !anyReady;
  const bothReady = claudeReady && openCodeReady;
  // Both engines installed but the user hasn't picked which one to spawn.
  // Block Continue until they do — there is no defensible default.
  const mustChoose = bothReady && preferred === null;
  // The auto-select effect below records the only ready engine as preferred
  // when the other is missing. Surface that decision under the ready pane so
  // the user can see what Obelus chose on their behalf — silent auto-select
  // makes it look like nothing happened.
  const onlyClaudeReady = claudeReady && !openCodeReady;
  const onlyOpenCodeReady = openCodeReady && !claudeReady;

  // When only one engine is ready, auto-record it as the preferred so the
  // user is not asked a question with no real input. The wizard's "Continue"
  // routes them straight through.
  useEffect(() => {
    if (checking) return;
    if (preferred !== null) return;
    if (claudeReady && !openCodeReady) {
      void setPreferred("claudeCode");
    } else if (openCodeReady && !claudeReady) {
      void setPreferred("openCode");
    }
  }, [checking, preferred, claudeReady, openCodeReady, setPreferred]);

  return (
    <article className="folio">
      <header className="folio__head">
        <p className="folio__eyebrow">I.</p>
        <h1 className="folio__title">First, the machinist.</h1>
      </header>
      <p className="folio__body">
        Obelus carries no model of its own. The reviewing is done by an AI engine, already on your
        machine. Either of these works:
      </p>

      <EnginePane id="claudeCode" status={claudeCode} autoSelected={onlyClaudeReady} />
      <EnginePane id="openCode" status={openCode} autoSelected={onlyOpenCodeReady} />

      {bothReady ? (
        <fieldset className="folio__choice">
          <legend className="folio__choice-legend">
            {mustChoose ? "Pick one to continue" : "Use this one for reviews"}
          </legend>
          <PreferredOption
            id="claudeCode"
            label="Claude Code"
            preferred={preferred}
            setPreferred={setPreferred}
          />
          <PreferredOption
            id="openCode"
            label="OpenCode"
            preferred={preferred}
            setPreferred={setPreferred}
          />
        </fieldset>
      ) : null}

      <footer className={`folio__foot${anyReady ? "" : " folio__foot--stack"}`}>
        {anyReady ? (
          <button
            type="button"
            className="folio__cta"
            onClick={onAdvance}
            disabled={mustChoose}
            title={mustChoose ? "Pick an engine above to continue." : undefined}
          >
            Continue <span aria-hidden="true">→</span>
          </button>
        ) : (
          <button type="button" className="folio__cta" onClick={onRecheck} disabled={checking}>
            {checking ? "Looking…" : "Check again"}
          </button>
        )}
        {stranded ? (
          <>
            <button type="button" className="folio__skip" onClick={onAdvance}>
              Continue without one <span aria-hidden="true">→</span>
            </button>
            <span className="folio__skip-note">
              I'll keep going. The review actions unlock once an engine is installed.
            </span>
          </>
        ) : null}
      </footer>
    </article>
  );
}

function PreferredOption({
  id,
  label,
  preferred,
  setPreferred,
}: {
  id: AiEngineId;
  label: string;
  preferred: AiEngineId | null;
  setPreferred: (id: AiEngineId) => Promise<void>;
}): JSX.Element {
  return (
    <label className={`folio__choice-option${preferred === id ? " folio__choice-option--on" : ""}`}>
      <input
        type="radio"
        name="preferred-engine"
        value={id}
        checked={preferred === id}
        onChange={() => {
          void setPreferred(id);
        }}
        className="visually-hidden"
      />
      <span>{label}</span>
    </label>
  );
}

function EnginePane({
  id,
  status,
  autoSelected = false,
}: {
  id: AiEngineId;
  status: AiEngineStatus | "checking";
  autoSelected?: boolean;
}): JSX.Element {
  const label = aiEngineLabel(id);
  const binary = id === "claudeCode" ? "claude" : "opencode";
  const signIn = aiEngineSignInHint(id);
  const autoNote = autoSelected ? <p className="folio__hint">Obelus will use this one.</p> : null;

  if (status === "checking") {
    return <pre className="folio__pane">{`${binary.padEnd(8)}—  looking\nauth    —  looking`}</pre>;
  }

  if (status.engine === "claudeCode") {
    const raw = status.raw;
    if (raw.status === "found") {
      return (
        <div>
          <pre className="folio__pane">
            {`${binary.padEnd(8)}—  found   ${raw.version ?? "(unknown)"}\nauth    —  your shell, your keys (sign in: ${signIn})`}
          </pre>
          {autoNote}
        </div>
      );
    }
    if (raw.status === "belowFloor") {
      return (
        <div className="folio__pane folio__pane--warn">
          <pre>{`${binary.padEnd(8)}—  too old (${raw.version ?? "?"})\nfloor   —  ${raw.floor}`}</pre>
          <div className="folio__pane-extras">
            <AiEngineMissing
              engine={id}
              hostOs={status.hostOs}
              lead={`Obelus expects a newer ${label}. Re-run the installer for your platform, then check again.`}
              trailing={null}
            />
          </div>
        </div>
      );
    }
    if (raw.status === "aboveCeiling") {
      return (
        <div className="folio__pane folio__pane--warn">
          <pre>{`${binary.padEnd(8)}—  newer than Obelus expects (${raw.version ?? "?"})`}</pre>
          <p className="folio__hint">
            This may still work. We will keep going, but file anything that breaks.
          </p>
        </div>
      );
    }
    if (raw.status === "unreadable") {
      return (
        <div className="folio__pane folio__pane--warn">
          <pre>{`${binary.padEnd(8)}—  found, but could not read version`}</pre>
          <p className="folio__hint">
            We will try to use it anyway. If things misbehave, run <code>{binary} --version</code>{" "}
            yourself to confirm it responds.
          </p>
          {autoNote}
        </div>
      );
    }
    return (
      <div className="folio__pane folio__pane--warn">
        <pre>{`${binary.padEnd(8)}—  not found on this machine`}</pre>
        <div className="folio__pane-extras">
          <AiEngineMissing
            engine={id}
            hostOs={status.hostOs}
            lead={`Install ${label}, then check again.`}
          />
        </div>
      </div>
    );
  }

  const raw = status.raw;
  if (raw.status === "found") {
    return (
      <div>
        <pre className="folio__pane">
          {`${binary.padEnd(8)}—  found   ${raw.version ?? "(unknown)"}\nauth    —  your shell, your keys (sign in: ${signIn})`}
        </pre>
        {autoNote}
      </div>
    );
  }
  if (raw.status === "unreadable") {
    return (
      <div className="folio__pane folio__pane--warn">
        <pre>{`${binary.padEnd(8)}—  found, but could not read version`}</pre>
        <p className="folio__hint">
          We will try to use it anyway. If things misbehave, run <code>{binary} --version</code>{" "}
          yourself to confirm it responds.
        </p>
        {autoNote}
      </div>
    );
  }
  return (
    <div className="folio__pane folio__pane--warn">
      <pre>{`${binary.padEnd(8)}—  not found on this machine`}</pre>
      <div className="folio__pane-extras">
        <AiEngineMissing
          engine={id}
          hostOs={status.hostOs}
          lead={`Install ${label}, then check again.`}
        />
      </div>
    </div>
  );
}
