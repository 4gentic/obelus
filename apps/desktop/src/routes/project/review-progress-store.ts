import {
  extractAssistantText,
  extractToolUses,
  hasThinkingBlock,
  isResult,
  type ParsedStreamEvent,
} from "@obelus/claude-sidecar";
import { create, type StoreApi, type UseBoundStore } from "zustand";

const PHASE_THROTTLE_MS = 500;

export interface ReviewProgressState {
  phase: string;
  toolEvents: number;
  assistantChars: number;
  lastThinkingAt: number | null;
  startedAt: number | null;
  _pendingPhase: string | null;
  _pendingTimer: number | null;
  _lastPhaseAt: number;

  start(): void;
  ingest(event: ParsedStreamEvent): void;
  reset(): void;
}

export type ReviewProgressStore = UseBoundStore<StoreApi<ReviewProgressState>>;

function describePhase(toolName: string, input: unknown): string {
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

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function firstToken(cmd: string): string {
  // Lift the first pipeline segment, trimming leading envs like `FOO=bar git …`.
  const first = cmd.split(/[|&;]/)[0] ?? cmd;
  const parts = first
    .trim()
    .split(/\s+/)
    .filter((p) => !/=/.test(p));
  return parts.slice(0, 3).join(" ") || cmd;
}

export function createReviewProgressStore(): ReviewProgressStore {
  return create<ReviewProgressState>()((set, get) => {
    function flushPhase(next: string): void {
      set({
        phase: next,
        _lastPhaseAt: Date.now(),
        _pendingPhase: null,
        _pendingTimer: null,
      });
    }

    function setPhase(next: string): void {
      const now = Date.now();
      const { _lastPhaseAt, _pendingTimer } = get();
      if (now - _lastPhaseAt >= PHASE_THROTTLE_MS) {
        if (_pendingTimer !== null) clearTimeout(_pendingTimer);
        flushPhase(next);
        return;
      }
      if (_pendingTimer !== null) clearTimeout(_pendingTimer);
      const remaining = PHASE_THROTTLE_MS - (now - _lastPhaseAt);
      const timer = setTimeout(() => {
        const queued = get()._pendingPhase;
        if (queued !== null) flushPhase(queued);
      }, remaining) as unknown as number;
      set({ _pendingPhase: next, _pendingTimer: timer });
    }

    return {
      phase: "",
      toolEvents: 0,
      assistantChars: 0,
      lastThinkingAt: null,
      startedAt: null,
      _pendingPhase: null,
      _pendingTimer: null,
      _lastPhaseAt: 0,

      start(): void {
        const { _pendingTimer } = get();
        if (_pendingTimer !== null) clearTimeout(_pendingTimer);
        set({
          phase: "",
          toolEvents: 0,
          assistantChars: 0,
          lastThinkingAt: null,
          startedAt: Date.now(),
          _pendingPhase: null,
          _pendingTimer: null,
          _lastPhaseAt: 0,
        });
      },

      ingest(event: ParsedStreamEvent): void {
        if (isResult(event)) {
          set({ lastThinkingAt: null });
          return;
        }
        const toolUses = extractToolUses(event);
        if (toolUses.length > 0) {
          const last = toolUses[toolUses.length - 1];
          if (last) {
            setPhase(describePhase(last.name, last.input));
            set((s) => ({ toolEvents: s.toolEvents + toolUses.length }));
          }
          return;
        }
        if (hasThinkingBlock(event)) {
          set({ lastThinkingAt: Date.now() });
        }
        const text = extractAssistantText(event);
        if (text) {
          set((s) => ({ assistantChars: s.assistantChars + text.length }));
        }
      },

      reset(): void {
        const { _pendingTimer } = get();
        if (_pendingTimer !== null) clearTimeout(_pendingTimer);
        set({
          phase: "",
          toolEvents: 0,
          assistantChars: 0,
          lastThinkingAt: null,
          startedAt: null,
          _pendingPhase: null,
          _pendingTimer: null,
          _lastPhaseAt: 0,
        });
      },
    };
  });
}
