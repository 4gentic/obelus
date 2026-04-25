import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type { PlanBlock, PlanFile } from "./plan";
export {
  PlanFile as PlanFileSchema,
  pickLatestPlanName,
  pickLatestWriteupName,
} from "./plan";

export interface ClaudeSpawnInput {
  rootId: string;
  projectId: string;
  bundleWorkspaceRelPath: string;
  extraPromptBody?: string;
  model?: string | null;
  effort?: string | null;
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
  return invoke<string>("claude_spawn", {
    rootId: input.rootId,
    projectId: input.projectId,
    bundleWorkspaceRelPath: input.bundleWorkspaceRelPath,
    extraPromptBody: input.extraPromptBody ?? null,
    model: input.model ?? null,
    effort: input.effort ?? null,
  });
}

export interface ClaudeAskInput {
  rootId: string;
  projectId: string;
  promptBody: string;
  model?: string | null;
  effort?: string | null;
}

export function claudeAsk(input: ClaudeAskInput): Promise<string> {
  return invoke<string>("claude_ask", {
    rootId: input.rootId,
    projectId: input.projectId,
    promptBody: input.promptBody,
    model: input.model ?? null,
    effort: input.effort ?? null,
  });
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
}

export function claudeDraftWriteup(input: ClaudeDraftWriteupInput): Promise<string> {
  return invoke<string>("claude_draft_writeup", {
    rootId: input.rootId,
    projectId: input.projectId,
    bundleWorkspaceRelPath: input.bundleWorkspaceRelPath,
    paperId: input.paperId,
    paperTitle: input.paperTitle,
    rubricWorkspaceRelPath: input.rubricWorkspaceRelPath ?? null,
    extraPromptBody: input.extraPromptBody ?? null,
    model: input.model ?? null,
    effort: input.effort ?? null,
  });
}

export interface ClaudeFixCompileInput {
  rootId: string;
  projectId: string;
  bundleWorkspaceRelPath: string;
  paperId: string;
  model?: string | null;
  effort?: string | null;
}

export function claudeFixCompile(input: ClaudeFixCompileInput): Promise<string> {
  return invoke<string>("claude_fix_compile", {
    rootId: input.rootId,
    projectId: input.projectId,
    bundleWorkspaceRelPath: input.bundleWorkspaceRelPath,
    paperId: input.paperId,
    model: input.model ?? null,
    effort: input.effort ?? null,
  });
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
  const subtype = typeof rec.subtype === "string" ? (rec.subtype as string) : undefined;
  return subtype === undefined ? { type, raw: rec } : { type, subtype, raw: rec };
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
