import type { JSX } from "react";
import type { ClaudeStatus } from "../../ipc/commands";

interface Props {
  claude: ClaudeStatus | "checking";
  onRecheck: () => void;
  onAdvance: () => void;
}

export default function FolioMachinist({ claude, onRecheck, onAdvance }: Props): JSX.Element {
  // Honor the "we will keep going" copy on aboveCeiling/unreadable: warn, but
  // don't block the wizard. Only truly-missing or too-old claude is fatal.
  const ready =
    claude !== "checking" &&
    (claude.status === "found" ||
      claude.status === "aboveCeiling" ||
      claude.status === "unreadable");
  return (
    <article className="folio">
      <header className="folio__head">
        <p className="folio__eyebrow">I.</p>
        <h1 className="folio__title">First, the machinist.</h1>
      </header>
      <p className="folio__body">
        Obelus does not speak to any model. It asks Claude Code, already on your disk, to do the
        work.
      </p>
      <ClaudePanel claude={claude} />
      <footer className="folio__foot">
        {ready ? (
          <button type="button" className="folio__cta" onClick={onAdvance}>
            Continue <span aria-hidden="true">→</span>
          </button>
        ) : (
          <button type="button" className="folio__cta" onClick={onRecheck}>
            Check again
          </button>
        )}
      </footer>
    </article>
  );
}

function ClaudePanel({ claude }: { claude: ClaudeStatus | "checking" }): JSX.Element {
  if (claude === "checking") {
    return <pre className="folio__pane">{"claude  —  looking\nauth    —  looking"}</pre>;
  }
  if (claude.status === "found") {
    return (
      <pre className="folio__pane">
        {`claude  —  found   ${claude.version ?? "(unknown)"}\nauth    —  your shell, your keys`}
      </pre>
    );
  }
  if (claude.status === "belowFloor") {
    return (
      <div className="folio__pane folio__pane--warn">
        <pre>{`claude  —  too old (${claude.version ?? "?"})\nfloor   —  ${claude.floor}`}</pre>
        <p className="folio__hint">
          Obelus expects a newer Claude Code. Upgrade with{" "}
          <code>npm i -g @anthropic-ai/claude-code</code>, then check again.
        </p>
      </div>
    );
  }
  if (claude.status === "aboveCeiling") {
    return (
      <div className="folio__pane folio__pane--warn">
        <pre>{`claude  —  newer than Obelus expects (${claude.version ?? "?"})`}</pre>
        <p className="folio__hint">
          This may still work. We will keep going, but file anything that breaks.
        </p>
      </div>
    );
  }
  if (claude.status === "unreadable") {
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
      <p className="folio__hint">Install Claude Code, then check again.</p>
      <pre className="folio__cmd">brew install anthropic/tap/claude</pre>
      <pre className="folio__cmd">npm i -g @anthropic-ai/claude-code</pre>
      <p className="folio__hint">I will check again when you come back.</p>
    </div>
  );
}
