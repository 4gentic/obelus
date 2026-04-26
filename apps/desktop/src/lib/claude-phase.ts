import {
  extractAssistantText,
  extractResultText,
  extractToolUses,
  type ParsedStreamEvent,
} from "@obelus/claude-sidecar";
import { artifactLabel } from "./artifact-label";

// Semantic phase labels emitted by the `plan-fix` skill as bare
// `[obelus:phase] <token>` lines at the top of each major section. The
// plugin-side contract lives in `packages/claude-plugin/skills/plan-fix/
// SKILL.md`; keep both sides in lockstep when extending.
const PHASE_MARKER_RE = /\[obelus:phase\]\s+(\S+)/;
export const SEMANTIC_PHASE_PREFIX = "obelus:" as const;

// Delta chunks can split the marker token mid-parse, so we scan the complete
// assistant text and the final result payload — never the partial stream
// events — to avoid false matches on prefixes like `[obelus:p`.
export function extractPhaseMarker(event: ParsedStreamEvent): string | null {
  const text = extractAssistantText(event) || extractResultText(event) || "";
  if (!text) return null;
  const match = text.match(PHASE_MARKER_RE);
  return match?.[1] ?? null;
}

export function isSemanticPhase(phase: string): boolean {
  return phase.startsWith(SEMANTIC_PHASE_PREFIX);
}

export function describePhase(toolName: string, input: unknown): string {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const str = (key: string): string | null => {
    const v = obj[key];
    return typeof v === "string" ? v : null;
  };

  switch (toolName) {
    case "Read": {
      const p = str("file_path");
      return p ? `Reading ${artifactLabel(p)}` : "Reading a file";
    }
    case "Grep": {
      const pat = str("pattern");
      const path = str("path");
      if (pat && path) return `Searching ${artifactLabel(path)} for \`${truncate(pat, 28)}\``;
      if (pat) return `Searching for \`${truncate(pat, 40)}\``;
      return "Searching the source";
    }
    case "Glob": {
      const pat = str("pattern");
      return pat ? `Listing ${truncate(pat, 40)}` : "Listing files";
    }
    case "Bash": {
      const cmd = str("command");
      const desc = str("description");
      if (desc) return truncate(desc, 60);
      if (cmd) return `Running \`${truncate(firstToken(cmd), 50)}\``;
      return "Running a shell command";
    }
    case "Edit":
    case "MultiEdit": {
      const p = str("file_path");
      return p ? `Editing ${artifactLabel(p)}` : "Editing a file";
    }
    case "Write": {
      const p = str("file_path");
      return p ? `Writing ${artifactLabel(p)}` : "Writing a file";
    }
    case "TodoWrite":
      return "Updating the plan";
    case "Task": {
      const desc = str("description");
      const agent = str("subagent_type");
      if (desc) return `Delegating: ${truncate(desc, 50)}`;
      if (agent) return `Delegating to ${agent}`;
      return "Delegating to a subagent";
    }
    case "WebFetch": {
      const url = str("url");
      return url ? `Fetching ${truncate(url, 48)}` : "Fetching a URL";
    }
    case "WebSearch": {
      const q = str("query");
      return q ? `Searching the web for \`${truncate(q, 40)}\`` : "Searching the web";
    }
    case "Skill": {
      const name = str("skill");
      return name ? `Loading skill \`${name}\`` : "Loading a skill";
    }
    case "ExitPlanMode":
      return "Finalizing the plan";
    case "NotebookEdit": {
      const p = str("notebook_path");
      return p ? `Editing ${artifactLabel(p)}` : "Editing a notebook";
    }
    default: {
      if (toolName.startsWith("mcp__")) {
        const short = toolName.slice("mcp__".length).replace(/_/g, " ");
        return `Calling ${short}`;
      }
      return `Using ${toolName}`;
    }
  }
}

export function phaseFromEvent(event: ParsedStreamEvent): string | null {
  const toolUses = extractToolUses(event);
  if (toolUses.length === 0) return null;
  const last = toolUses[toolUses.length - 1];
  if (!last) return null;
  return describePhase(last.name, last.input);
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function firstToken(cmd: string): string {
  const first = cmd.split(/[|&;]/)[0] ?? cmd;
  const parts = first
    .trim()
    .split(/\s+/)
    .filter((p) => !/=/.test(p));
  return parts.slice(0, 3).join(" ") || cmd;
}
