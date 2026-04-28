import type { JSX } from "react";
import AiEngineMissing from "../../components/ai-engine-missing";
import { type AiEngineStatus, aiEngineLabel } from "../../lib/ai-engine";

interface Props {
  engine: AiEngineStatus | "checking";
  onRecheck: () => void;
  onAdvance: () => void;
}

export default function FolioMachinist({ engine, onRecheck, onAdvance }: Props): JSX.Element {
  const checking = engine === "checking";
  const ready = !checking && engine.ready;
  const stranded = !checking && !engine.ready;
  return (
    <article className="folio">
      <header className="folio__head">
        <p className="folio__eyebrow">I.</p>
        <h1 className="folio__title">First, the machinist.</h1>
      </header>
      <p className="folio__body">
        Obelus carries no model of its own. The reviewing is done by Claude Code, already on your
        machine.
      </p>
      <ClaudePanel engine={engine} />
      <footer className={`folio__foot${ready ? "" : " folio__foot--stack"}`}>
        {ready ? (
          <button type="button" className="folio__cta" onClick={onAdvance}>
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
              Continue without it <span aria-hidden="true">→</span>
            </button>
            <span className="folio__skip-note">
              I'll keep going. The review actions unlock once Claude Code is installed.
            </span>
          </>
        ) : null}
      </footer>
    </article>
  );
}

function ClaudePanel({ engine }: { engine: AiEngineStatus | "checking" }): JSX.Element {
  if (engine === "checking") {
    return <pre className="folio__pane">{"claude  —  looking\nauth    —  looking"}</pre>;
  }
  const raw = engine.raw;
  if (raw.status === "found") {
    return (
      <pre className="folio__pane">
        {`claude  —  found   ${raw.version ?? "(unknown)"}\nauth    —  your shell, your keys`}
      </pre>
    );
  }
  if (raw.status === "belowFloor") {
    return (
      <div className="folio__pane folio__pane--warn">
        <pre>{`claude  —  too old (${raw.version ?? "?"})\nfloor   —  ${raw.floor}`}</pre>
        <div className="folio__pane-extras">
          <AiEngineMissing
            engine={engine.engine}
            hostOs={engine.hostOs}
            lead={`Obelus expects a newer ${aiEngineLabel(engine.engine)}. Re-run the installer for your platform, then check again.`}
            trailing={null}
          />
        </div>
      </div>
    );
  }
  if (raw.status === "aboveCeiling") {
    return (
      <div className="folio__pane folio__pane--warn">
        <pre>{`claude  —  newer than Obelus expects (${raw.version ?? "?"})`}</pre>
        <p className="folio__hint">
          This may still work. We will keep going, but file anything that breaks.
        </p>
      </div>
    );
  }
  if (raw.status === "unreadable") {
    return (
      <div className="folio__pane folio__pane--warn">
        <pre>{"claude  —  found, but could not read version"}</pre>
        <p className="folio__hint">
          We will try to use it anyway. If things misbehave, run <code>claude --version</code>{" "}
          yourself to confirm it responds.
        </p>
      </div>
    );
  }
  return (
    <div className="folio__pane folio__pane--warn">
      <pre>{"claude  —  not found on this machine"}</pre>
      <div className="folio__pane-extras">
        <AiEngineMissing
          engine={engine.engine}
          hostOs={engine.hostOs}
          lead="Install Claude Code, then check again."
        />
      </div>
    </div>
  );
}
