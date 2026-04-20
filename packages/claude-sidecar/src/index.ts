import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type { PlanBlock, PlanFile } from "./plan";
export { PlanFile as PlanFileSchema, pickLatestPlanName } from "./plan";

export interface ClaudeSpawnInput {
  rootId: string;
  bundleRelPath: string;
  extraPromptBody?: string;
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
    bundleRelPath: input.bundleRelPath,
    extraPromptBody: input.extraPromptBody ?? null,
  });
}

export interface ClaudeAskInput {
  rootId: string;
  promptBody: string;
}

export function claudeAsk(input: ClaudeAskInput): Promise<string> {
  return invoke<string>("claude_ask", {
    rootId: input.rootId,
    promptBody: input.promptBody,
  });
}

export interface ClaudeDraftWriteupInput {
  rootId: string;
  bundleRelPath: string;
  paperId: string;
  paperTitle: string;
  rubricRelPath?: string;
}

export function claudeDraftWriteup(input: ClaudeDraftWriteupInput): Promise<string> {
  return invoke<string>("claude_draft_writeup", {
    rootId: input.rootId,
    bundleRelPath: input.bundleRelPath,
    paperId: input.paperId,
    paperTitle: input.paperTitle,
    rubricRelPath: input.rubricRelPath ?? null,
  });
}

export function claudeCancel(sessionId: string): Promise<void> {
  return invoke<void>("claude_cancel", { sessionId });
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
