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

// The live transcript is unbounded over a long run; keep a trailing window so
// the console stays responsive and memory stays flat. Older entries fall off
// the top with a visible marker rather than vanishing silently.
const MAX_ENTRIES = 500;

// One line of the reviewer's live narration. `assistant` entries accumulate
// the streamed prose of a single turn; a `tool` entry is one tool invocation,
// rendered as a breadcrumb atom. Thinking is tracked separately via
// `lastThinkingAt` (a transient pulse, not a transcript line).
export type TranscriptEntry = { kind: "assistant"; text: string } | { kind: "tool"; label: string };

export interface ReviewProgressState {
  phase: string;
  toolEvents: number;
  assistantChars: number;
  lastThinkingAt: number | null;
  startedAt: number | null;
  entries: TranscriptEntry[];
  trimmed: boolean;
  _pendingPhase: string | null;
  _pendingTimer: ReturnType<typeof setTimeout> | null;
  _lastPhaseAt: number;

  start(): void;
  ingest(event: ParsedStreamEvent): void;
  reset(): void;
}

function capped(
  entries: TranscriptEntry[],
  prevTrimmed: boolean,
): { entries: TranscriptEntry[]; trimmed: boolean } {
  if (entries.length <= MAX_ENTRIES) return { entries, trimmed: prevTrimmed };
  return { entries: entries.slice(entries.length - MAX_ENTRIES), trimmed: true };
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
      entries: [],
      trimmed: false,
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
          entries: [],
          trimmed: false,
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
          if (last) setPhase(describePhase(last.name, last.input));
          set((s) => {
            const atoms = toolUses.map(
              (t): TranscriptEntry => ({ kind: "tool", label: describePhase(t.name, t.input) }),
            );
            const next = s.entries.concat(atoms);
            return { toolEvents: s.toolEvents + toolUses.length, ...capped(next, s.trimmed) };
          });
          return;
        }
        if (hasThinkingBlock(event)) {
          set({ lastThinkingAt: Date.now() });
        }
        const text = extractAssistantText(event);
        if (text) {
          set((s) => {
            const last = s.entries[s.entries.length - 1];
            // Merge consecutive assistant deltas into one turn; a tool call in
            // between starts a fresh turn (last is no longer `assistant`).
            const next =
              last?.kind === "assistant"
                ? s.entries.slice(0, -1).concat({ kind: "assistant", text: last.text + text })
                : s.entries.concat({ kind: "assistant", text });
            return { assistantChars: s.assistantChars + text.length, ...capped(next, s.trimmed) };
          });
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
          entries: [],
          trimmed: false,
          _pendingPhase: null,
          _pendingTimer: null,
          _lastPhaseAt: 0,
        });
      },
    };
  });
}
