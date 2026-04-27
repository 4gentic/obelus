import { claudeAsk } from "@obelus/claude-sidecar";
import { formatSpawnInvocation } from "@obelus/prompts";
import { type JSX, useState } from "react";
import { useProject } from "./context";

// Hidden behind `import.meta.env.VITE_DRAFTER_PREVIEW === "1"` (see
// `ReviewColumn.tsx`). The full design lives in `docs/drafter-design.md`;
// this is the spike — one button that runs `/spec` against the open project.
//
// Spike shortcut: we use `claudeAsk` rather than `claudeSpawn` so we do not
// need to bundle the drafter plugin into Tauri's resources or extend the
// Rust spawn surface. The downside is the user must have `obelus-drafter`
// installed locally for the `/spec` slash command to resolve; otherwise
// Claude Code returns a "no such command" message. The full build will
// add the drafter plugin to `bundle.resources` and use `claudeSpawn` with
// `--plugin-dir` so the command resolves out of the box.
export default function DrafterTab(): JSX.Element {
  const { rootId, project } = useProject();
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "starting" }
    | { kind: "started"; sessionId: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function onRunSpec(): Promise<void> {
    setStatus({ kind: "starting" });
    try {
      const promptBody = formatSpawnInvocation({
        kind: "ask",
        promptBody:
          "Run /spec on this paper. Pick the next section that has no spec yet, or ask me which one to start with if you cannot tell.",
      });
      const sessionId = await claudeAsk({
        rootId,
        projectId: project.id,
        promptBody,
        model: null,
        effort: null,
      });
      setStatus({ kind: "started", sessionId });
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Could not reach Claude.",
      });
    }
  }

  return (
    <section className="reviewer-actions" aria-label="Draft">
      <header className="reviewer-actions__head">
        <h2 className="reviewer-actions__heading">Draft (preview)</h2>
      </header>
      <p className="reviewer-actions__hint">
        Drafter mode is in preview. The full workflow (spec → research → draft → critique → iterate
        → assemble) is specified in <code>docs/drafter-design.md</code>; for now this tab runs the{" "}
        <code>/spec</code> command against the open project so the architecture can be validated end
        to end.
      </p>
      <div className="reviewer-actions__claude">
        <div className="reviewer-actions__claude-head">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void onRunSpec()}
            disabled={status.kind === "starting"}
          >
            {status.kind === "starting" ? "Starting…" : "Run /spec on this paper"}
          </button>
          <span className="reviewer-actions__claude-label">
            {status.kind === "started"
              ? `Session ${status.sessionId.slice(0, 8)} started.`
              : status.kind === "error"
                ? status.message
                : "Calls Claude with the obelus-drafter plugin's /spec command."}
          </span>
        </div>
      </div>
    </section>
  );
}
