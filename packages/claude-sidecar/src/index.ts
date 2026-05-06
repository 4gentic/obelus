import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type { PlanBlock, PlanEmptyReason, PlanFile } from "./plan";
export {
  PLAN_EMPTY_REASONS,
  PlanFile as PlanFileSchema,
  pickLatestPlanName,
  pickLatestWriteupName,
} from "./plan";

export type ClaudeSpawnMode = "writer-fast" | "rigorous" | "deep-review";

// Which AI engine to dispatch to. The desktop's `requireSpawnEngine()` returns
// an `AiEngineStatus`; call sites pass `engine: status.engine` so the sidecar
// can route to the matching Tauri command. Omitted or "claudeCode" → Claude
// Code path (the existing default). "openCode" → opencode_spawn; the three
// non-spawn entry points fall back to Claude Code with a console.warn until
// OpenCode parity lands.
export type SpawnEngine = "claudeCode" | "openCode";

export interface ClaudeSpawnInput {
  rootId: string;
  projectId: string;
  bundleWorkspaceRelPath: string;
  extraPromptBody?: string;
  model?: string | null;
  effort?: string | null;
  mode?: ClaudeSpawnMode;
  engine?: SpawnEngine;
}

export interface ClaudeStreamEvent {
  sessionId: string;
  line: string;
  ts: string;
}

export interface ClaudeExitEvent {
  sessionId: string;
  code: number | null;
  cancelled: boolean;
}

export function claudeSpawn(input: ClaudeSpawnInput): Promise<string> {
  const args = {
    rootId: input.rootId,
    projectId: input.projectId,
    bundleWorkspaceRelPath: input.bundleWorkspaceRelPath,
    extraPromptBody: input.extraPromptBody ?? null,
    model: input.model ?? null,
    effort: input.effort ?? null,
    mode: input.mode ?? null,
  };
  if (input.engine === "openCode") {
    return invoke<string>("opencode_spawn", args);
  }
  return invoke<string>("claude_spawn", args);
}

export interface ClaudeAskInput {
  rootId: string;
  projectId: string;
  promptBody: string;
  model?: string | null;
  effort?: string | null;
  engine?: SpawnEngine;
}

export function claudeAsk(input: ClaudeAskInput): Promise<string> {
  const args = {
    rootId: input.rootId,
    projectId: input.projectId,
    promptBody: input.promptBody,
    model: input.model ?? null,
    effort: input.effort ?? null,
  };
  if (input.engine === "openCode") {
    return invoke<string>("opencode_ask", args);
  }
  return invoke<string>("claude_ask", args);
}

export interface ClaudeDraftWriteupInput {
  rootId: string;
  projectId: string;
  bundleWorkspaceRelPath: string;
  paperId: string;
  paperTitle: string;
  rubricWorkspaceRelPath?: string;
  extraPromptBody?: string | null;
  model?: string | null;
  effort?: string | null;
  engine?: SpawnEngine;
}

export function claudeDraftWriteup(input: ClaudeDraftWriteupInput): Promise<string> {
  const args = {
    rootId: input.rootId,
    projectId: input.projectId,
    bundleWorkspaceRelPath: input.bundleWorkspaceRelPath,
    paperId: input.paperId,
    paperTitle: input.paperTitle,
    rubricWorkspaceRelPath: input.rubricWorkspaceRelPath ?? null,
    extraPromptBody: input.extraPromptBody ?? null,
    model: input.model ?? null,
    effort: input.effort ?? null,
  };
  if (input.engine === "openCode") {
    return invoke<string>("opencode_draft_writeup", args);
  }
  return invoke<string>("claude_draft_writeup", args);
}

export interface ClaudeFixCompileInput {
  rootId: string;
  projectId: string;
  bundleWorkspaceRelPath: string;
  paperId: string;
  model?: string | null;
  effort?: string | null;
  engine?: SpawnEngine;
}

export function claudeFixCompile(input: ClaudeFixCompileInput): Promise<string> {
  const args = {
    rootId: input.rootId,
    projectId: input.projectId,
    bundleWorkspaceRelPath: input.bundleWorkspaceRelPath,
    paperId: input.paperId,
    model: input.model ?? null,
    effort: input.effort ?? null,
  };
  if (input.engine === "openCode") {
    return invoke<string>("opencode_fix_compile", args);
  }
  return invoke<string>("claude_fix_compile", args);
}

export function claudeCancel(sessionId: string): Promise<void> {
  return invoke<void>("claude_cancel", { sessionId });
}

// True iff a previously spawned Claude subprocess is still running. Survives
// a WebView refresh because the Rust process and its child subprocesses do.
export function claudeIsAlive(sessionId: string): Promise<boolean> {
  return invoke<boolean>("claude_is_alive", { sessionId });
}

export function onClaudeStdout(cb: (e: ClaudeStreamEvent) => void): Promise<UnlistenFn> {
  return listen<ClaudeStreamEvent>("claude:stdout", (ev) => cb(ev.payload));
}

export function onClaudeStderr(cb: (e: ClaudeStreamEvent) => void): Promise<UnlistenFn> {
  return listen<ClaudeStreamEvent>("claude:stderr", (ev) => cb(ev.payload));
}

export function onClaudeExit(cb: (e: ClaudeExitEvent) => void): Promise<UnlistenFn> {
  return listen<ClaudeExitEvent>("claude:exit", (ev) => cb(ev.payload));
}

// --- stream-json parsing ----------------------------------------------------
// `claude --print --output-format stream-json --include-partial-messages`
// emits one JSON object per line. Shape varies across Claude Code versions;
// we parse tolerantly and expose a few typed probes for the fields we use.

export interface ParsedStreamEvent {
  readonly type: string;
  readonly subtype?: string;
  readonly raw: Record<string, unknown>;
}

export function parseStreamLine(line: string): ParsedStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const rec = obj as Record<string, unknown>;
  const type = typeof rec.type === "string" ? (rec.type as string) : "";
  if (!type) return null;
  // OpenCode (`opencode run --format json`) emits a different vocabulary —
  // `step_start` / `step_finish` / `tool_use` / `text` — than Claude Code's
  // `assistant` / `result` / `stream_event`. Normalize at parse time so every
  // downstream extractor (phase log, OBELUS_WROTE matcher, usage tracker)
  // stays engine-agnostic.
  const normalised = normaliseOpenCodeEvent(type, rec);
  if (normalised) return normalised;
  const subtype = typeof rec.subtype === "string" ? (rec.subtype as string) : undefined;
  return subtype === undefined ? { type, raw: rec } : { type, subtype, raw: rec };
}

// Top-level event types unique to OpenCode's `--format json` stream. Disjoint
// from Claude Code's top-level set (`system` / `assistant` / `user` / `result`
// / `stream_event`), so checking by type is sufficient.
const OPENCODE_TOP_LEVEL_TYPES: ReadonlySet<string> = new Set([
  "step_start",
  "step_finish",
  "tool_use",
  "text",
]);

// OpenCode emits tool names lowercase (`read`, `glob`, `multiedit`); the rest
// of the codebase keys on Claude Code's TitleCase form. The map covers every
// tool the desktop's `describePhase` recognises plus a `capitaliseFirst`
// fallback for anything new the upstream catalog adds.
const OPENCODE_TOOL_NAMES: Readonly<Record<string, string>> = {
  read: "Read",
  glob: "Glob",
  grep: "Grep",
  bash: "Bash",
  edit: "Edit",
  multiedit: "MultiEdit",
  write: "Write",
  todowrite: "TodoWrite",
  task: "Task",
  webfetch: "WebFetch",
  websearch: "WebSearch",
  notebookedit: "NotebookEdit",
};

function capitaliseFirst(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function recordAt(rec: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const v = rec[key];
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function normaliseOpenCodeEvent(
  type: string,
  rec: Record<string, unknown>,
): ParsedStreamEvent | null {
  if (!OPENCODE_TOP_LEVEL_TYPES.has(type)) return null;
  const part = recordAt(rec, "part");

  if (type === "tool_use" && part) {
    const tool = typeof part.tool === "string" ? part.tool : "";
    if (!tool) return null;
    const state = recordAt(part, "state") ?? {};
    const input = state.input;
    const name = OPENCODE_TOOL_NAMES[tool] ?? capitaliseFirst(tool);
    const synthesised: Record<string, unknown> = {
      type: "assistant",
      message: { content: [{ type: "tool_use", name, input: input ?? {} }] },
    };
    return { type: "assistant", raw: synthesised };
  }

  if (type === "text" && part) {
    const text = typeof part.text === "string" ? part.text : "";
    const synthesised: Record<string, unknown> = {
      type: "assistant",
      message: { content: [{ type: "text", text }] },
    };
    return { type: "assistant", raw: synthesised };
  }

  if (type === "step_finish" && part) {
    const tokens = recordAt(part, "tokens") ?? {};
    const cache = recordAt(tokens, "cache") ?? {};
    const usage = {
      input_tokens: numberAt(tokens, "input"),
      output_tokens: numberAt(tokens, "output"),
      cache_read_input_tokens: numberAt(cache, "read"),
      cache_creation_input_tokens: numberAt(cache, "write"),
    };
    if (part.reason === "stop") {
      // Final step → synthesise a Claude Code `result` so `isResult` /
      // `extractUsage` / `extractResultText` all wake up at end-of-run.
      const synthesised: Record<string, unknown> = {
        type: "result",
        subtype: "success",
        usage,
        result: "",
      };
      return { type: "result", subtype: "success", raw: synthesised };
    }
    // Mid-step usage update — dress it as an `assistant` event so the
    // session-level usage tracker keeps the latest cumulative tokens.
    const synthesised: Record<string, unknown> = {
      type: "assistant",
      message: { usage },
    };
    return { type: "assistant", raw: synthesised };
  }

  // `step_start` carries no payload our extractors care about — and crucially
  // not the model id either. OpenCode's `--format json` parts identify the
  // message they belong to via `messageID` but the resolved provider+model
  // lives on the Message itself, which is not emitted as a top-level event.
  // Surface a typed event so the watchdog still ticks; model resolution for
  // OpenCode runs through the stderr `service=llm` log line instead (see
  // `parseOpenCodeModelLogLine`).
  return { type, raw: rec };
}

// OpenCode's `--print-logs --log-level INFO` writes one line to stderr when
// it resolves a model for the workhorse agent, of shape:
//
//   INFO  <ts> +<ms>ms service=llm providerID=<p> modelID=<m> \
//     sessionID=<s> small=false agent=build mode=primary stream
//
// `small=true` is the title-summariser; we ignore it. The first `small=false`
// line is the answer. Returns `provider/model` to disambiguate when the same
// id appears under multiple providers; null when the line shape doesn't match.
export function parseOpenCodeModelLogLine(line: string): string | null {
  if (!line.includes("service=llm")) return null;
  if (!line.includes("small=false")) return null;
  const provider = matchKv(line, "providerID");
  const model = matchKv(line, "modelID");
  if (!model) return null;
  return provider ? `${provider}/${model}` : model;
}

// Reads a single space-or-newline-terminated `key=value` token from a log
// line. Values are alphanumerics + `-`, `_`, `.`, `/` — covers every
// providerID/modelID OpenCode currently emits.
function matchKv(line: string, key: string): string | null {
  const re = new RegExp(`(?:^|\\s)${key}=([\\w./-]+)`);
  const m = line.match(re);
  return m ? (m[1] ?? null) : null;
}

function contentBlocks(event: ParsedStreamEvent): ReadonlyArray<Record<string, unknown>> {
  const msg = event.raw.message;
  if (!msg || typeof msg !== "object") return [];
  const content = (msg as Record<string, unknown>).content;
  if (!Array.isArray(content)) return [];
  return content.filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null);
}

export interface StreamToolUse {
  readonly name: string;
  readonly input: unknown;
}

export function extractToolUses(event: ParsedStreamEvent): ReadonlyArray<StreamToolUse> {
  if (event.type !== "assistant") return [];
  const out: StreamToolUse[] = [];
  for (const block of contentBlocks(event)) {
    if (block.type !== "tool_use") continue;
    const name = typeof block.name === "string" ? block.name : "";
    if (!name) continue;
    out.push({ name, input: block.input });
  }
  return out;
}

export function extractAssistantText(event: ParsedStreamEvent): string {
  if (event.type !== "assistant") return "";
  let out = "";
  for (const block of contentBlocks(event)) {
    if (block.type === "text" && typeof block.text === "string") {
      out += block.text as string;
    }
  }
  return out;
}

export function hasThinkingBlock(event: ParsedStreamEvent): boolean {
  if (event.type !== "assistant") return false;
  return contentBlocks(event).some((b) => b.type === "thinking");
}

export function isResult(event: ParsedStreamEvent): boolean {
  return event.type === "result";
}

// With `--include-partial-messages`, Claude Code wraps raw API stream events
// in `{type: "stream_event", event: ...}`. Pull text out of text_delta blocks.
export function extractDeltaText(event: ParsedStreamEvent): string {
  if (event.type !== "stream_event") return "";
  const inner = event.raw.event;
  if (!inner || typeof inner !== "object") return "";
  const rec = inner as Record<string, unknown>;
  if (rec.type !== "content_block_delta") return "";
  const delta = rec.delta;
  if (!delta || typeof delta !== "object") return "";
  const deltaRec = delta as Record<string, unknown>;
  if (deltaRec.type !== "text_delta") return "";
  return typeof deltaRec.text === "string" ? (deltaRec.text as string) : "";
}

export function extractResultText(event: ParsedStreamEvent): string | null {
  if (event.type !== "result") return null;
  const r = event.raw.result;
  return typeof r === "string" ? r : null;
}

// Cumulative usage emitted on the terminal `result` event (and per-turn on
// `assistant` events). `result.usage` is the authoritative session total.
export interface StreamUsage {
  readonly inputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly outputTokens: number;
}

function numberAt(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function extractUsage(event: ParsedStreamEvent): StreamUsage | null {
  const direct = event.raw.usage;
  if (direct && typeof direct === "object") {
    const u = direct as Record<string, unknown>;
    return {
      inputTokens: numberAt(u, "input_tokens"),
      cacheReadInputTokens: numberAt(u, "cache_read_input_tokens"),
      cacheCreationInputTokens: numberAt(u, "cache_creation_input_tokens"),
      outputTokens: numberAt(u, "output_tokens"),
    };
  }
  const msg = event.raw.message;
  if (msg && typeof msg === "object") {
    const nested = (msg as Record<string, unknown>).usage;
    if (nested && typeof nested === "object") {
      const u = nested as Record<string, unknown>;
      return {
        inputTokens: numberAt(u, "input_tokens"),
        cacheReadInputTokens: numberAt(u, "cache_read_input_tokens"),
        cacheCreationInputTokens: numberAt(u, "cache_creation_input_tokens"),
        outputTokens: numberAt(u, "output_tokens"),
      };
    }
  }
  return null;
}

export function extractModel(event: ParsedStreamEvent): string | null {
  const directModel = event.raw.model;
  if (typeof directModel === "string" && directModel) return directModel;
  const msg = event.raw.message;
  if (msg && typeof msg === "object") {
    const m = (msg as Record<string, unknown>).model;
    if (typeof m === "string" && m) return m;
  }
  return null;
}

// True when the stream is closing a content block (text or tool use). Useful
// to insert a visual separator in a live transcript so consecutive turns
// don't collide ("…composition logic.Now I'll compose…").
export function isContentBlockStop(event: ParsedStreamEvent): boolean {
  if (event.type !== "stream_event") return false;
  const inner = event.raw.event;
  if (!inner || typeof inner !== "object") return false;
  return (inner as Record<string, unknown>).type === "content_block_stop";
}
