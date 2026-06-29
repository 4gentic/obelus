import type { JSX } from "react";
import type { UseCompileResult } from "./use-compile";

interface Props {
  label: string;
  compile: UseCompileResult;
}

export default function CompileToolbar({ label, compile }: Props): JSX.Element {
  const { state, run, askFix, compileLabel, engineReady, engineGate, canFix } = compile;
  return (
    <>
      <header className="compile-pane__head">
        <span className="compile-pane__label">{label}</span>
        <div className="compile-pane__actions">
          {state.kind === "error" && canFix && (
            <button
              type="button"
              className="btn btn--subtle"
              onClick={() => void askFix()}
              disabled={!engineReady}
              title={
                engineReady
                  ? "Send the compile error to an AI fix-compile job"
                  : engineGate === "must-pick"
                    ? "Pick an engine in Settings to enable AI fixes."
                    : "Install an AI engine from Settings to enable AI fixes."
              }
            >
              Fix with AI
            </button>
          )}
          <button
            type="button"
            className="btn btn--primary"
            disabled={state.kind === "compiling" || state.kind === "fixing"}
            onClick={() => void run()}
          >
            {compileLabel}
          </button>
        </div>
      </header>
      {state.kind === "error" && (
        <pre className="compile-pane__banner compile-pane__banner--err">{state.message}</pre>
      )}
      {state.kind === "done" && state.warnings.trim() !== "" && (
        <pre className="compile-pane__banner">{state.warnings}</pre>
      )}
    </>
  );
}
