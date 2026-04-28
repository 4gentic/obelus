import type { JSX } from "react";
import type { HostOs } from "../ipc/commands";
import { type AiEngineId, aiEngineInstallHints, aiEngineLabel } from "../lib/ai-engine";
import "./ai-engine-missing.css";

interface Props {
  engine: AiEngineId;
  hostOs: HostOs;
  // Lead text — defaults to "<Label> is not installed on this machine."
  // Settings overrides this with its own copy when the engine is found but
  // the version is below floor.
  lead?: string;
  // Trailing copy below the commands. Defaults to a "check again" reminder.
  trailing?: string | null;
}

export default function AiEngineMissing({ engine, hostOs, lead, trailing }: Props): JSX.Element {
  const hints = aiEngineInstallHints(engine, hostOs);
  const headline = lead ?? `${aiEngineLabel(engine)} is not installed on this machine.`;
  const closing = trailing === null ? null : (trailing ?? "I will check again when you come back.");
  return (
    <div className="ai-engine-missing">
      <p className="ai-engine-missing__hint">{headline}</p>
      <div className="ai-engine-missing__cmds">
        {hints.map((hint) => (
          <div key={hint.command}>
            <span className="ai-engine-missing__cmd-label">{hint.label}</span>
            <pre className="ai-engine-missing__cmd">{hint.command}</pre>
          </div>
        ))}
      </div>
      {closing ? <p className="ai-engine-missing__hint">{closing}</p> : null}
    </div>
  );
}
