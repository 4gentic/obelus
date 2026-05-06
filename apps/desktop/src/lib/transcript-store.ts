import type { ParsedStreamEvent } from "@obelus/claude-sidecar";
import { useMemo } from "react";
import { create, type StoreApi, type UseBoundStore } from "zustand";
import {
  computeStats,
  emptyState,
  finalize as finalizeState,
  ingest as ingestEvent,
  type TerminalStatus,
  type TranscriptBlock,
  type TranscriptState,
  type TranscriptStats,
} from "./transcript-reducer";

// Live transcript blocks per Claude/OpenCode session. Memory-only and lifetime-
// scoped to the app process — same contract as `jobs-store.ts`.

interface TranscriptStoreState {
  sessions: Record<string, TranscriptState>;
  ingest(sessionId: string, parsed: ParsedStreamEvent, atMs: number): void;
  finalize(sessionId: string, status: TerminalStatus, atMs: number): TranscriptStats;
  dismiss(sessionId: string): number;
  get(sessionId: string): TranscriptState | undefined;
}

export type TranscriptStore = UseBoundStore<StoreApi<TranscriptStoreState>>;

const EMPTY_BLOCKS: ReadonlyArray<TranscriptBlock> = Object.freeze([]);
const EMPTY_STATS: TranscriptStats = Object.freeze({
  blockCount: 0,
  toolCount: 0,
  textBlocks: 0,
  thinkingBlocks: 0,
  droppedForOverflow: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
});

export const useTranscriptStore: TranscriptStore = create<TranscriptStoreState>()((set, get) => ({
  sessions: {},

  ingest(sessionId, parsed, atMs) {
    set((s) => {
      const existing = s.sessions[sessionId];
      const start = existing ?? emptyState();
      if (!existing) {
        console.info("[transcript-begin]", { sessionId });
      }
      const next = ingestEvent(start, parsed, atMs);
      // Reference-equal: skip the set to avoid spurious re-renders.
      if (next === start) return s;
      return { sessions: { ...s.sessions, [sessionId]: next } };
    });
  },

  finalize(sessionId, status, atMs) {
    let snapshot: TranscriptStats = EMPTY_STATS;
    set((s) => {
      const existing = s.sessions[sessionId];
      if (!existing) return s;
      const next = finalizeState(existing, status, atMs);
      snapshot = computeStats(next);
      return { sessions: { ...s.sessions, [sessionId]: next } };
    });
    console.info("[transcript-final]", { sessionId, status, ...snapshot });
    return snapshot;
  },

  dismiss(sessionId) {
    let retained = 0;
    set((s) => {
      const existing = s.sessions[sessionId];
      if (!existing) return s;
      retained = existing.blocks.length;
      const sessions = { ...s.sessions };
      delete sessions[sessionId];
      return { sessions };
    });
    if (retained > 0) {
      console.info("[transcript-dismiss]", { sessionId, retainedBlocks: retained });
    }
    return retained;
  },

  get(sessionId) {
    return get().sessions[sessionId];
  },
}));

// Selector hooks — kept thin so consumers don't need to recompute.
// `useBlocks` returns a stable empty array reference when the session is
// absent so React's referential-equality short-circuit holds.

export function useTranscriptBlocks(sessionId: string): ReadonlyArray<TranscriptBlock> {
  return useTranscriptStore((s) => s.sessions[sessionId]?.blocks ?? EMPTY_BLOCKS);
}

export function useTranscriptStats(sessionId: string): TranscriptStats {
  // The selector must return a stable reference per state. `computeStats`
  // allocates a new object every call, which trips React's
  // `useSyncExternalStore` cache guard ("getSnapshot should be cached…")
  // and feeds an infinite render loop. Read the session as the selector
  // result (stable across reducer no-ops) and memoise the derived stats.
  const session = useTranscriptStore((s) => s.sessions[sessionId]);
  return useMemo(() => (session ? computeStats(session) : EMPTY_STATS), [session]);
}

export function useHasTranscript(sessionId: string): boolean {
  return useTranscriptStore((s) => s.sessions[sessionId] !== undefined);
}
