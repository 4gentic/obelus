import {
  extractAssistantText,
  extractToolUses,
  hasThinkingBlock,
  isResult,
  type ParsedStreamEvent,
} from "@obelus/claude-sidecar";
import { create, type StoreApi, type UseBoundStore } from "zustand";
import { describePhase } from "../../lib/claude-phase";

const PHASE_THROTTLE_MS = 500;

export interface ReviewProgressState {
  phase: string;
  toolEvents: number;
  assistantChars: number;
  lastThinkingAt: number | null;
  startedAt: number | null;
  _pendingPhase: string | null;
  _pendingTimer: ReturnType<typeof setTimeout> | null;
  _lastPhaseAt: number;

  start(): void;
  ingest(event: ParsedStreamEvent): void;
  reset(): void;
}

export type ReviewProgressStore = UseBoundStore<StoreApi<ReviewProgressState>>;

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
      }, remaining);
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
