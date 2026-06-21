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
// `[obelus:note] <free text>`, captured to end of line. `[^\n]` keeps the note
// to a single line so a paragraph following the marker isn't swallowed; the
// `phase` regex's `\S+` token can't match here because notes carry free text.
const NOTE_MARKER_RE = /\[obelus:note\]\s+([^\n]+)/;
export const SEMANTIC_PHASE_PREFIX = "obelus:" as const;

// Delta chunks can split the marker token mid-parse, so we scan the complete
// assistant text and the final result payload — never the partial stream
// events — to avoid false matches on prefixes like `[obelus:p`.
function fullEventText(event: ParsedStreamEvent): string {
  return extractAssistantText(event) || extractResultText(event) || "";
}

export function extractPhaseMarker(event: ParsedStreamEvent): string | null {
  const text = fullEventText(event);
  if (!text) return null;
  const match = text.match(PHASE_MARKER_RE);
  return match?.[1] ?? null;
}

// Sibling of `extractPhaseMarker` for `[obelus:note]` milestone lines the skill
// emits to narrate progress ("Drafted 6 edits"). Same whole-text scan to dodge
// split deltas.
export function extractNoteMarker(event: ParsedStreamEvent): string | null {
  const text = fullEventText(event);
  if (!text) return null;
  const match = text.match(NOTE_MARKER_RE);
  return match?.[1]?.trim() ?? null;
}

export function isSemanticPhase(phase: string): boolean {
  return phase.startsWith(SEMANTIC_PHASE_PREFIX);
}

// Phase tokens the `plan-fix` skill emits, mapped to the noun phrase shown in
// the live feed's header. Unknown tokens are title-cased so a new skill phase
// still reads cleanly without a code change here.
const PHASE_LABELS: Readonly<Record<string, string>> = {
  preflight: "Preparing",
  "gather-context": "Gathering context",
  "locating-spans": "Locating passages",
  "stress-test": "Stress-testing edits",
  "impact-sweep": "Impact sweep",
  "coherence-sweep": "Coherence sweep",
  "quality-sweep": "Quality sweep",
  "writing-plan": "Writing the plan",
};

export function humanizePhase(token: string): string {
  const known = PHASE_LABELS[token];
  if (known) return known;
  return token
    .split("-")
    .map((word) => (word.length === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

// A short suffix appended to a tool breadcrumb once its result lands, so the
// feed shows the shape of the answer ("12 matches", "84 lines") rather than a
// bare "Reading X". Content may be empty (tools that produce no stdout).
export function summarizeToolResult(toolName: string, content: string, isError: boolean): string {
  if (isError) return "error";
  if (toolName === "Read") {
    const lines = content === "" ? 0 : content.split(/\r?\n/).length;
    return `${lines} line${lines === 1 ? "" : "s"}`;
  }
  if (toolName === "Grep") {
    const matches = content.split(/\r?\n/).filter((l) => l.trim() !== "").length;
    return `${matches} match${matches === 1 ? "" : "es"}`;
  }
  const firstLine =
    content
      .split(/\r?\n/)
      .find((l) => l.trim() !== "")
      ?.trim() ?? "";
  if (firstLine === "") return "done";
  return truncate(firstLine, 40);
}

export function describePhase(toolName: string, input: unknown): string {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  // Tool inputs arrive in two key conventions: snake_case (`file_path`) from
  // Claude Code, camelCase (`filePath`) from OpenCode. Look up both so the
  // narration is meaningful regardless of which engine produced the event.
  const str = (key: string): string | null => {
    const v = obj[key];
    if (typeof v === "string") return v;
    const alt = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    if (alt !== key) {
      const v2 = obj[alt];
      if (typeof v2 === "string") return v2;
    }
    return null;
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
