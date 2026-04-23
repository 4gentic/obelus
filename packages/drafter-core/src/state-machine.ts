import type { Stage } from "./draft-state.js";

// The legal transitions out of each stage. The state machine is descriptive,
// not enforced — the desktop UI uses it to recommend the next button, but the
// user can run any command at any time. See `docs/drafter-design.md#5`.
//
// Transitions:
//   spec      → research                          (after the spec is written, gather sources)
//   research  → draft                             (after notes are ready, compose)
//   draft     → critique                          (once a draft exists, review it)
//   critique  → iterate | assemble                (revision needed, or accept)
//   iterate   → research | draft                  (re-enter the loop with the critique)
//   assemble  → ∅                                 (terminal — re-runs are manual)
const TRANSITIONS: Readonly<Record<Stage, ReadonlyArray<Stage>>> = {
  spec: ["research"],
  research: ["draft"],
  draft: ["critique"],
  critique: ["iterate", "assemble"],
  iterate: ["research", "draft"],
  assemble: [],
};

export function nextStages(current: Stage): ReadonlyArray<Stage> {
  return TRANSITIONS[current];
}

export function canAdvance(from: Stage, to: Stage): boolean {
  return TRANSITIONS[from].includes(to);
}
