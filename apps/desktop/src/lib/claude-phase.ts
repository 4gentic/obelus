import { extractToolUses, type ParsedStreamEvent } from "@obelus/claude-sidecar";

export function describePhase(toolName: string, input: unknown): string {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const str = (key: string): string | null => {
    const v = obj[key];
    return typeof v === "string" ? v : null;
  };

  switch (toolName) {
    case "Read": {
      const p = str("file_path");
      return p ? `Reading ${basename(p)}` : "Reading a file";
    }
    case "Grep": {
      const pat = str("pattern");
      const path = str("path");
      if (pat && path) return `Searching ${basename(path)} for \`${truncate(pat, 28)}\``;
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
      return p ? `Editing ${basename(p)}` : "Editing a file";
    }
    case "Write": {
      const p = str("file_path");
      return p ? `Writing ${basename(p)}` : "Writing a file";
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
      return p ? `Editing ${basename(p)}` : "Editing a notebook";
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

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
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
