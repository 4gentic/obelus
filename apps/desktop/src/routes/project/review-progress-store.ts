import {
  extractAssistantText,
  extractInlineToolResult,
  extractThinkingText,
  extractToolUses,
  hasThinkingBlock,
  isResult,
  type ParsedStreamEvent,
  parseToolResults,
} from "@obelus/claude-sidecar";
import { create, type StoreApi, type UseBoundStore } from "zustand";
import {
  describePhase,
  extractNoteMarker,
  extractPhaseMarker,
  humanizePhase,
  summarizeToolResult,
} from "../../lib/claude-phase";

const PHASE_THROTTLE_MS = 500;

// The live transcript is unbounded over a long run; keep a trailing window so
// the console stays responsive and memory stays flat. Older entries fall off
// the top with a visible marker rather than vanishing silently.
const MAX_ENTRIES = 500;

// One line of the reviewer's live narration. `assistant` and `thinking` entries
// accumulate streamed prose of a single turn; `phase` is a semantic section
// divider; `note` is a milestone the skill called out; a `tool` entry is one
// tool invocation (or a coalesced batch), gaining a `result` suffix once its
// tool_result lands.
export type TranscriptEntry =
  | { kind: "assistant"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "phase"; label: string }
  | { kind: "note"; text: string }
  | { kind: "tool"; label: string; result?: string; error?: boolean };

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
  // Once a `[obelus:phase]` marker fires, tool breadcrumbs must stop steering
  // the header — the semantic phase is the better signal and should stick.
  _hasSemanticPhase: boolean;
  // tool_use id → the `tool` entry it landed in. A coalesced batch maps every
  // member id to the same index. `name` is the raw tool name (Read/Grep/…) so a
  // single-tool result can summarise by line/match count. Survives the
  // trailing-window trim because we never reindex; trimmed entries simply stop
  // being looked up.
  _toolIndexById: Map<string, { index: number; name: string }>;
  // For a coalesced batch entry, how many tool_results are still outstanding;
  // when it reaches 0 the entry's summary collapses to "done"/"error".
  _outstandingByIndex: Map<number, { remaining: number; anyError: boolean }>;

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

// Remove whole `[obelus:phase] …` / `[obelus:note] …` lines from streamed prose
// so a recognised marker never leaks into the rendered assistant body. Leftover
// runs of blank lines collapse to a single break.
function stripMarkerLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*\[obelus:(phase|note)\]/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// The verb a coalesced batch of same-category tools should read as. Returns
// null when the batch isn't uniform, signalling the caller to push one
// breadcrumb per use instead.
function coalescedLabel(uses: ReadonlyArray<{ name: string }>): string | null {
  if (uses.length < 2) return null;
  const first = uses[0];
  if (!first) return null;
  const name = first.name;
  if (!uses.every((u) => u.name === name)) return null;
  if (name === "Read") return `Reading ${uses.length} files`;
  if (name === "Edit" || name === "MultiEdit") return `Editing ${uses.length} files`;
  return `${uses.length} ${name} calls`;
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

    function pushEntries(toAppend: TranscriptEntry[]): void {
      if (toAppend.length === 0) return;
      set((s) => {
        const next = s.entries.concat(toAppend);
        return capped(next, s.trimmed);
      });
    }

    function initialState(startedAt: number | null): Partial<ReviewProgressState> {
      return {
        phase: "",
        toolEvents: 0,
        assistantChars: 0,
        lastThinkingAt: null,
        startedAt,
        entries: [],
        trimmed: false,
        _pendingPhase: null,
        _pendingTimer: null,
        _lastPhaseAt: 0,
        _hasSemanticPhase: false,
        _toolIndexById: new Map(),
        _outstandingByIndex: new Map(),
      };
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
      _hasSemanticPhase: false,
      _toolIndexById: new Map(),
      _outstandingByIndex: new Map(),

      start(): void {
        const { _pendingTimer } = get();
        if (_pendingTimer !== null) clearTimeout(_pendingTimer);
        set(initialState(Date.now()));
      },

      ingest(event: ParsedStreamEvent): void {
        // 1. Terminal result: clear the thinking pulse and surface a trailing
        //    `[obelus:note]` if the skill left one in its final message.
        if (isResult(event)) {
          set({ lastThinkingAt: null });
          const finalNote = extractNoteMarker(event);
          if (finalNote) pushEntries([{ kind: "note", text: finalNote }]);
          return;
        }

        // 2. Semantic phase marker: drives the header and the in-body divider.
        const phaseToken = extractPhaseMarker(event);
        if (phaseToken) {
          const label = humanizePhase(phaseToken);
          set({ _hasSemanticPhase: true });
          pushEntries([{ kind: "phase", label }]);
          setPhase(label);
        }

        // 3. Note marker.
        const note = extractNoteMarker(event);
        if (note) pushEntries([{ kind: "note", text: note }]);

        // 4. Thinking: pulse + a mergeable reasoning entry.
        if (hasThinkingBlock(event)) {
          const thinkingText = extractThinkingText(event);
          set({ lastThinkingAt: Date.now() });
          if (thinkingText) {
            set((s) => {
              const last = s.entries[s.entries.length - 1];
              const next =
                last?.kind === "thinking"
                  ? s.entries
                      .slice(0, -1)
                      .concat({ kind: "thinking", text: last.text + thinkingText })
                  : s.entries.concat({ kind: "thinking", text: thinkingText });
              return capped(next, s.trimmed);
            });
          }
        }

        // 5. Tool uses: coalesce a uniform batch into one breadcrumb, else one
        //    per use. Record the id → entry-index map so arriving tool_results
        //    can attach their summary. Tools steer the header only until a
        //    semantic phase has taken over.
        const toolUses = extractToolUses(event);
        if (toolUses.length > 0) {
          if (!get()._hasSemanticPhase) {
            const last = toolUses[toolUses.length - 1];
            if (last) setPhase(describePhase(last.name, last.input));
          }
          const coalesced = coalescedLabel(toolUses);
          set((s) => {
            const entries = s.entries.slice();
            const toolIndexById = new Map(s._toolIndexById);
            const outstandingByIndex = new Map(s._outstandingByIndex);
            if (coalesced !== null) {
              const index = entries.length;
              entries.push({ kind: "tool", label: coalesced });
              for (const use of toolUses) {
                if (use.id) toolIndexById.set(use.id, { index, name: use.name });
              }
              outstandingByIndex.set(index, { remaining: toolUses.length, anyError: false });
            } else {
              for (const use of toolUses) {
                const index = entries.length;
                entries.push({ kind: "tool", label: describePhase(use.name, use.input) });
                if (use.id) toolIndexById.set(use.id, { index, name: use.name });
              }
            }
            const { entries: kept, trimmed } = capped(entries, s.trimmed);
            return {
              toolEvents: s.toolEvents + toolUses.length,
              entries: kept,
              trimmed,
              _toolIndexById: toolIndexById,
              _outstandingByIndex: outstandingByIndex,
            };
          });

          // OpenCode ships the tool's output on the same event; attach it to
          // the breadcrumb we just pushed.
          const inline = extractInlineToolResult(event);
          if (inline) {
            set((s) => {
              const entries = s.entries.slice();
              const idx = entries.length - 1;
              const target = entries[idx];
              if (!target || target.kind !== "tool") return {};
              const preview = (inline.preview.split(/\r?\n/)[0] ?? "").slice(0, 40).trim();
              entries[idx] = {
                ...target,
                result: inline.isError ? "error" : preview || "done",
                error: inline.isError,
              };
              return { entries };
            });
          }
        }

        // 6. Remaining prose, with marker lines stripped so a recognised
        //    `[obelus:*]` line never renders as raw narration.
        const text = stripMarkerLines(extractAssistantText(event));
        if (text) {
          set((s) => {
            const last = s.entries[s.entries.length - 1];
            const next =
              last?.kind === "assistant"
                ? s.entries.slice(0, -1).concat({ kind: "assistant", text: last.text + text })
                : s.entries.concat({ kind: "assistant", text });
            return { assistantChars: s.assistantChars + text.length, ...capped(next, s.trimmed) };
          });
        }

        // 7. Tool results (Claude Code path): correlate each by id and write
        //    its summary onto the breadcrumb, collapsing coalesced batches once
        //    every member has reported.
        const results = parseToolResults(event);
        if (results.length > 0) {
          set((s) => {
            const entries = s.entries.slice();
            const outstandingByIndex = new Map(s._outstandingByIndex);
            let changed = false;
            for (const r of results) {
              const located = s._toolIndexById.get(r.toolUseId);
              if (located === undefined) continue;
              const { index, name } = located;
              const target = entries[index];
              if (!target || target.kind !== "tool") continue;
              const batch = outstandingByIndex.get(index);
              if (batch) {
                const remaining = batch.remaining - 1;
                const anyError = batch.anyError || r.isError;
                outstandingByIndex.set(index, { remaining, anyError });
                if (remaining <= 0) {
                  entries[index] = {
                    ...target,
                    result: anyError ? "error" : "done",
                    error: anyError,
                  };
                  changed = true;
                }
              } else {
                entries[index] = {
                  ...target,
                  result: summarizeToolResult(name, r.content, r.isError),
                  error: r.isError,
                };
                changed = true;
              }
            }
            if (!changed) return { _outstandingByIndex: outstandingByIndex };
            return { entries, _outstandingByIndex: outstandingByIndex };
          });
        }
      },

      reset(): void {
        const { _pendingTimer } = get();
        if (_pendingTimer !== null) clearTimeout(_pendingTimer);
        set(initialState(null));
      },
    };
  });
}
