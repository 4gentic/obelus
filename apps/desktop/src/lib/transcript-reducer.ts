import {
  extractAssistantText,
  extractDeltaText,
  extractDeltaThinking,
  extractInlineToolResult,
  extractThinkingText,
  extractToolUses,
  extractUsage,
  isContentBlockStop,
  type ParsedStreamEvent,
  parseToolResults,
  type StreamUsage,
} from "@obelus/claude-sidecar";
import { describePhase } from "./claude-phase";

// Hard caps. Numbers chosen so a long deep-review (~600 events) stays well
// under ~5 MB heap per session.
export const MAX_BLOCKS = 400;
export const MAX_TEXT_LIVE_BYTES = 8_000;
export const MAX_TEXT_KEEP_BYTES = 4_000;
export const TEXT_HEAD_BYTES = 2_000;
export const TEXT_TAIL_BYTES = 1_000;
export const MAX_THINKING_BYTES = 16_000;
export const THINKING_PREVIEW_CHARS = 140;

export type BlockId = string;

interface BaseBlock {
  readonly id: BlockId;
  readonly startedAt: number;
  readonly closed: boolean;
}

export interface TextBlock extends BaseBlock {
  readonly kind: "text";
  readonly text: string;
}

export interface ThinkingBlock extends BaseBlock {
  readonly kind: "thinking";
  readonly text: string;
  readonly preview: string;
}

export type ToolResultStatus = "pending" | "ok" | "error";

export interface ToolBlock extends BaseBlock {
  readonly kind: "tool";
  readonly name: string;
  readonly input: unknown;
  readonly caption: string;
  readonly resultStatus: ToolResultStatus;
  readonly resultPreview?: string;
}

export interface ToolGroupBlock extends BaseBlock {
  readonly kind: "tool-group";
  readonly name: string;
  readonly members: ReadonlyArray<ToolBlock>;
}

export type StatusVariant = "exit" | "overflow";

export interface StatusBlock extends BaseBlock {
  readonly kind: "status";
  readonly variant: StatusVariant;
  readonly label: string;
}

export type TranscriptBlock = TextBlock | ThinkingBlock | ToolBlock | ToolGroupBlock | StatusBlock;

export interface TranscriptState {
  readonly blocks: ReadonlyArray<TranscriptBlock>;
  readonly openTextId: BlockId | null;
  readonly openThinkingId: BlockId | null;
  readonly pendingTools: ReadonlyMap<string, BlockId>; // toolUseId → tool block id
  readonly usage: StreamUsage | null;
  readonly firstEventAt: number | null;
  // Tracks whether a text or thinking delta arrived between the previous
  // `assistant` event and the next one. When true, the assistant event's
  // content is redundant with what we've already streamed and we skip it.
  // When false (OpenCode, or Claude without `--include-partial-messages`),
  // we ingest the assistant content as closed blocks.
  readonly sawDeltaSinceLastAssistant: boolean;
  readonly blockCounter: number;
  readonly droppedForOverflow: number;
}

export type TerminalStatus = "done" | "error" | "cancelled";

export function emptyState(): TranscriptState {
  return {
    blocks: [],
    openTextId: null,
    openThinkingId: null,
    pendingTools: new Map(),
    usage: null,
    firstEventAt: null,
    sawDeltaSinceLastAssistant: false,
    blockCounter: 0,
    droppedForOverflow: 0,
  };
}

export interface TranscriptStats {
  readonly blockCount: number;
  readonly toolCount: number;
  readonly textBlocks: number;
  readonly thinkingBlocks: number;
  readonly droppedForOverflow: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
}

export function computeStats(state: TranscriptState): TranscriptStats {
  let toolCount = 0;
  let textBlocks = 0;
  let thinkingBlocks = 0;
  for (const b of state.blocks) {
    if (b.kind === "text") textBlocks++;
    else if (b.kind === "thinking") thinkingBlocks++;
    else if (b.kind === "tool") toolCount++;
    else if (b.kind === "tool-group") toolCount += b.members.length;
  }
  const u = state.usage;
  return {
    blockCount: state.blocks.length,
    toolCount,
    textBlocks,
    thinkingBlocks,
    droppedForOverflow: state.droppedForOverflow,
    inputTokens: u?.inputTokens ?? 0,
    outputTokens: u?.outputTokens ?? 0,
    cacheReadInputTokens: u?.cacheReadInputTokens ?? 0,
    cacheCreationInputTokens: u?.cacheCreationInputTokens ?? 0,
  };
}

export function ingest(
  state: TranscriptState,
  parsed: ParsedStreamEvent,
  atMs: number,
): TranscriptState {
  let next: TranscriptState = {
    ...state,
    firstEventAt: state.firstEventAt ?? atMs,
  };

  const usage = extractUsage(parsed);
  if (usage) next = { ...next, usage };

  if (parsed.type === "stream_event") {
    const deltaText = extractDeltaText(parsed);
    if (deltaText) {
      next = appendTextDelta(next, deltaText, atMs);
    }
    const deltaThinking = extractDeltaThinking(parsed);
    if (deltaThinking) {
      next = appendThinkingDelta(next, deltaThinking, atMs);
    }
    if (isContentBlockStop(parsed)) {
      next = closeOpenBlocks(next);
    }
    return next;
  }

  if (parsed.type === "assistant") {
    next = ingestAssistant(next, parsed, atMs);
    next = { ...next, sawDeltaSinceLastAssistant: false };
    return next;
  }

  if (parsed.type === "user") {
    next = ingestUserToolResults(next, parsed);
    return next;
  }

  return next;
}

function ingestAssistant(
  state: TranscriptState,
  parsed: ParsedStreamEvent,
  atMs: number,
): TranscriptState {
  let next = state;

  // When no deltas have arrived for this turn, the assistant event is the
  // first time we learn the text/thinking content (OpenCode, older Claude
  // builds). Push closed blocks for whatever it carries.
  if (!state.sawDeltaSinceLastAssistant) {
    const text = extractAssistantText(parsed);
    if (text) {
      const id = nextId(next);
      next = withCounterBumped(next);
      const block: TextBlock = {
        id,
        kind: "text",
        startedAt: atMs,
        closed: true,
        text: compactText(text),
      };
      next = pushBlock(next, block);
    }
    const thinking = extractThinkingText(parsed);
    if (thinking) {
      const id = nextId(next);
      next = withCounterBumped(next);
      const block: ThinkingBlock = {
        id,
        kind: "thinking",
        startedAt: atMs,
        closed: true,
        text: clampLength(thinking, MAX_THINKING_BYTES),
        preview: thinking.slice(0, THINKING_PREVIEW_CHARS),
      };
      next = pushBlock(next, block);
    }
  }

  // Tool uses are only ever discovered from assistant events; no streaming
  // duplication risk. Each new tool use gets a ToolBlock; consecutive uses of
  // the same tool name are folded into a ToolGroupBlock (Task is the
  // exception — distinct subagent runs stay distinct).
  const toolUses = extractToolUses(parsed);
  const pushedIds: BlockId[] = [];
  for (const use of toolUses) {
    const id = nextId(next);
    next = withCounterBumped(next);
    const tool: ToolBlock = {
      id,
      kind: "tool",
      startedAt: atMs,
      closed: false,
      name: use.name,
      input: use.input,
      caption: describePhase(use.name, use.input),
      resultStatus: "pending",
    };
    // The tool_use_id lives on the raw block; extractToolUses doesn't expose
    // it, so peek at the raw content here. Without it we can't match the
    // arriving tool_result, but we still render the tool — it just stays
    // pending and gets marked "no result" on finalize.
    const useId = readToolUseId(parsed, use.name, use.input);
    next = pushTool(next, tool, useId);
    pushedIds.push(id);
  }

  // Inline result events (e.g. OpenCode normalised tool_use → output) carry
  // the result on the same event as the tool_use, so close the matching tool
  // immediately rather than waiting for a follow-up `tool_result` that will
  // never arrive.
  if (pushedIds.length === 1) {
    const inline = extractInlineToolResult(parsed);
    if (inline) {
      const tid = pushedIds[0];
      if (tid !== undefined) {
        const preview = inline.preview.split(/\r?\n/)[0]?.slice(0, 160) ?? "";
        next = updateToolBlock(next, tid, (tool) => ({
          ...tool,
          closed: true,
          resultStatus: inline.isError ? "error" : "ok",
          ...(preview ? { resultPreview: preview } : {}),
        }));
        const useIdToClear = findUseId(next, tid);
        if (useIdToClear) {
          const pending = new Map(next.pendingTools);
          pending.delete(useIdToClear);
          next = { ...next, pendingTools: pending };
        }
      }
    }
  }

  return next;
}

function readToolUseId(parsed: ParsedStreamEvent, name: string, input: unknown): string | null {
  const msg = parsed.raw.message;
  if (!msg || typeof msg !== "object") return null;
  const content = (msg as Record<string, unknown>).content;
  if (!Array.isArray(content)) return null;
  // Walk in declaration order and match the first tool_use with the same
  // name+input we haven't matched yet — extractToolUses preserves order so
  // this is reliable for the single tool_use case (overwhelmingly the norm).
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const rec = block as Record<string, unknown>;
    if (rec.type !== "tool_use") continue;
    if (rec.name !== name) continue;
    if (!shallowInputEqual(rec.input, input)) continue;
    return typeof rec.id === "string" ? (rec.id as string) : null;
  }
  return null;
}

function shallowInputEqual(a: unknown, b: unknown): boolean {
  // Reference identity is enough for the same parsed object passed through.
  // The caller compares the same `input` reference returned by the same
  // `extractToolUses` walk against the raw content array.
  return a === b;
}

function ingestUserToolResults(state: TranscriptState, parsed: ParsedStreamEvent): TranscriptState {
  const results = parseToolResults(parsed);
  if (results.length === 0) return state;
  let next = state;
  for (const r of results) {
    const tid = next.pendingTools.get(r.toolUseId);
    if (!tid) continue;
    const preview = r.content.split(/\r?\n/)[0]?.slice(0, 160) ?? "";
    next = updateToolBlock(next, tid, (tool) => ({
      ...tool,
      closed: true,
      resultStatus: r.isError ? "error" : "ok",
      ...(preview ? { resultPreview: preview } : {}),
    }));
    const nextPending = new Map(next.pendingTools);
    nextPending.delete(r.toolUseId);
    next = { ...next, pendingTools: nextPending };
  }
  return next;
}

function appendTextDelta(state: TranscriptState, delta: string, atMs: number): TranscriptState {
  let next = { ...state, sawDeltaSinceLastAssistant: true };
  if (next.openTextId === null) {
    const id = nextId(next);
    next = withCounterBumped(next);
    const block: TextBlock = {
      id,
      kind: "text",
      startedAt: atMs,
      closed: false,
      text: delta.slice(0, MAX_TEXT_LIVE_BYTES),
    };
    next = pushBlock(next, block);
    return { ...next, openTextId: id };
  }
  const targetId = next.openTextId;
  return updateBlockById(next, targetId, (b): TranscriptBlock => {
    if (b.kind !== "text") return b;
    const merged = b.text + delta;
    return {
      ...b,
      text: merged.length > MAX_TEXT_LIVE_BYTES ? merged.slice(0, MAX_TEXT_LIVE_BYTES) : merged,
    };
  });
}

function appendThinkingDelta(state: TranscriptState, delta: string, atMs: number): TranscriptState {
  let next = { ...state, sawDeltaSinceLastAssistant: true };
  if (next.openThinkingId === null) {
    const id = nextId(next);
    next = withCounterBumped(next);
    const block: ThinkingBlock = {
      id,
      kind: "thinking",
      startedAt: atMs,
      closed: false,
      text: delta.slice(0, MAX_THINKING_BYTES),
      preview: delta.slice(0, THINKING_PREVIEW_CHARS),
    };
    next = pushBlock(next, block);
    return { ...next, openThinkingId: id };
  }
  const targetId = next.openThinkingId;
  return updateBlockById(next, targetId, (b): TranscriptBlock => {
    if (b.kind !== "thinking") return b;
    const merged = b.text + delta;
    return {
      ...b,
      text: merged.length > MAX_THINKING_BYTES ? merged.slice(0, MAX_THINKING_BYTES) : merged,
      // Preview is frozen on first delta — the subsequent updates leave it.
      preview: b.preview,
    };
  });
}

function closeOpenBlocks(state: TranscriptState): TranscriptState {
  let next = state;
  if (next.openTextId !== null) {
    const targetId = next.openTextId;
    next = updateBlockById(next, targetId, (b): TranscriptBlock => {
      if (b.kind !== "text") return b;
      return { ...b, closed: true, text: compactText(b.text) };
    });
    next = { ...next, openTextId: null };
  }
  if (next.openThinkingId !== null) {
    const targetId = next.openThinkingId;
    next = updateBlockById(next, targetId, (b): TranscriptBlock => {
      if (b.kind !== "thinking") return b;
      return { ...b, closed: true };
    });
    next = { ...next, openThinkingId: null };
  }
  return next;
}

function compactText(text: string): string {
  if (text.length <= MAX_TEXT_KEEP_BYTES) return text;
  const head = text.slice(0, TEXT_HEAD_BYTES);
  const tail = text.slice(text.length - TEXT_TAIL_BYTES);
  return `${head}\n…\n${tail}`;
}

function clampLength(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

function pushBlock(state: TranscriptState, block: TranscriptBlock): TranscriptState {
  const blocks = [...state.blocks, block];
  return enforceBlockCap({ ...state, blocks });
}

function pushTool(state: TranscriptState, tool: ToolBlock, useId: string | null): TranscriptState {
  // Group post-step: fold consecutive same-name tools into a ToolGroupBlock.
  // Task is exempt — distinct subagent runs are first-class entries.
  const last = state.blocks[state.blocks.length - 1];
  let blocks: TranscriptBlock[];
  if (tool.name !== "Task" && last) {
    if (last.kind === "tool" && last.name === tool.name) {
      const merged: ToolGroupBlock = {
        id: `${last.id}+grp`,
        kind: "tool-group",
        name: tool.name,
        startedAt: last.startedAt,
        closed: false,
        members: [last, tool],
      };
      blocks = [...state.blocks.slice(0, -1), merged];
    } else if (last.kind === "tool-group" && last.name === tool.name) {
      const merged: ToolGroupBlock = {
        ...last,
        closed: false,
        members: [...last.members, tool],
      };
      blocks = [...state.blocks.slice(0, -1), merged];
    } else {
      blocks = [...state.blocks, tool];
    }
  } else {
    blocks = [...state.blocks, tool];
  }
  let next: TranscriptState = { ...state, blocks };
  if (useId) {
    const pending = new Map(next.pendingTools);
    pending.set(useId, tool.id);
    next = { ...next, pendingTools: pending };
  }
  return enforceBlockCap(next);
}

function updateBlockById(
  state: TranscriptState,
  id: BlockId,
  fn: (b: TranscriptBlock) => TranscriptBlock,
): TranscriptState {
  const blocks = state.blocks.map((b) => (b.id === id ? fn(b) : b));
  return { ...state, blocks };
}

function updateToolBlock(
  state: TranscriptState,
  id: BlockId,
  fn: (t: ToolBlock) => ToolBlock,
): TranscriptState {
  // Tool block id may live inside a ToolGroupBlock — walk groups too.
  const blocks = state.blocks.map((b): TranscriptBlock => {
    if (b.kind === "tool" && b.id === id) return fn(b);
    if (b.kind === "tool-group") {
      const idx = b.members.findIndex((m) => m.id === id);
      if (idx === -1) return b;
      const member = b.members[idx];
      if (!member) return b;
      const updatedMember = fn(member);
      const members = [...b.members];
      members[idx] = updatedMember;
      const allClosed = members.every((m) => m.closed);
      return { ...b, members, closed: allClosed };
    }
    return b;
  });
  return { ...state, blocks };
}

function enforceBlockCap(state: TranscriptState): TranscriptState {
  if (state.blocks.length <= MAX_BLOCKS) return state;
  // Keep one slot reserved for the overflow marker. Count only event-blocks
  // (not a previous overflow marker) toward `droppedForOverflow` so the
  // displayed count never inflates when one stale marker is replaced by a
  // newer one.
  const targetKeep = MAX_BLOCKS - 1;
  let trimmed = state.blocks.slice(state.blocks.length - targetKeep);
  const lost = state.blocks.slice(0, state.blocks.length - trimmed.length);
  const lostEvents = lost.filter((b) => !(b.kind === "status" && b.variant === "overflow")).length;
  const head = trimmed[0];
  if (head?.kind === "status" && head.variant === "overflow") {
    trimmed = trimmed.slice(1);
  }
  const droppedForOverflow = state.droppedForOverflow + lostEvents;
  const overflow: StatusBlock = {
    id: "overflow",
    kind: "status",
    variant: "overflow",
    startedAt: state.firstEventAt ?? 0,
    closed: true,
    label: `${droppedForOverflow} earlier ${droppedForOverflow === 1 ? "event" : "events"} hidden`,
  };
  return {
    ...state,
    blocks: [overflow, ...trimmed],
    droppedForOverflow,
  };
}

function nextId(state: TranscriptState): BlockId {
  return `b${state.blockCounter}`;
}

function withCounterBumped(state: TranscriptState): TranscriptState {
  return { ...state, blockCounter: state.blockCounter + 1 };
}

export function finalize(
  state: TranscriptState,
  status: TerminalStatus,
  atMs: number,
): TranscriptState {
  let next = closeOpenBlocks(state);

  // Mark any tool whose result never arrived as errored. Walk groups too.
  if (next.pendingTools.size > 0) {
    const blocks = next.blocks.map((b): TranscriptBlock => {
      if (b.kind === "tool" && next.pendingTools.has(findUseId(next, b.id) ?? "")) {
        return { ...b, closed: true, resultStatus: "error", resultPreview: "No result received." };
      }
      if (b.kind === "tool-group") {
        const members = b.members.map((m): ToolBlock => {
          const useId = findUseId(next, m.id);
          if (useId && next.pendingTools.has(useId)) {
            return {
              ...m,
              closed: true,
              resultStatus: "error",
              resultPreview: "No result received.",
            };
          }
          return m;
        });
        return { ...b, members, closed: members.every((m) => m.closed) };
      }
      return b;
    });
    next = { ...next, blocks, pendingTools: new Map() };
  }

  const elapsedMs = next.firstEventAt === null ? 0 : Math.max(0, atMs - next.firstEventAt);
  const exit: StatusBlock = {
    id: `b${next.blockCounter}`,
    kind: "status",
    variant: "exit",
    startedAt: atMs,
    closed: true,
    label: exitLabel(status, elapsedMs),
  };
  next = withCounterBumped(next);
  next = { ...next, blocks: [...next.blocks, exit] };
  return next;
}

function exitLabel(status: TerminalStatus, elapsedMs: number): string {
  const elapsed = formatElapsed(elapsedMs);
  if (status === "done") return `Done · ${elapsed}`;
  if (status === "error") return `Error · ${elapsed}`;
  return `Cancelled · ${elapsed}`;
}

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem.toString().padStart(2, "0")}s`;
}

function findUseId(state: TranscriptState, blockId: BlockId): string | null {
  for (const [k, v] of state.pendingTools) if (v === blockId) return k;
  return null;
}
