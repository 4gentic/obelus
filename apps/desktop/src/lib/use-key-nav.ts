import { useEffect, useRef } from "react";

export type KeyHandler = (ev: KeyboardEvent) => void;

// Two-key chords (like `gg`) must resolve within this window.
const CHORD_TIMEOUT_MS = 800;

export interface KeyMap {
  // Single-key bindings keyed by KeyboardEvent.key. Shift is encoded via the
  // capital letter (e.g. "A"); modifiers beyond Shift are not supported —
  // this hook is for modeless bindings inside the diff review column.
  [key: string]: KeyHandler | KeyMap | undefined;
}

export interface UseKeyNavOptions {
  enabled: boolean;
  // Called before dispatch; return true to skip the event (e.g. while a
  // textarea inside the column has focus).
  shouldIgnore?: (ev: KeyboardEvent) => boolean;
}

function defaultShouldIgnore(ev: KeyboardEvent): boolean {
  const target = ev.target as HTMLElement | null;
  if (!target) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

// Hand-rolled keyboard dispatcher. Keymap can nest — a leaf handler is a
// function; a branch is another map keyed by the follow-up key (e.g.
// `{ g: { g: goToTop } }` for `gg`). Unknown follow-ups clear the pending
// chord silently.
export function useKeyNav(map: KeyMap, options: UseKeyNavOptions): void {
  const mapRef = useRef(map);
  mapRef.current = map;
  const ignoreRef = useRef(options.shouldIgnore ?? defaultShouldIgnore);
  ignoreRef.current = options.shouldIgnore ?? defaultShouldIgnore;

  useEffect(() => {
    if (!options.enabled) return;
    let pending: { map: KeyMap; at: number } | null = null;

    const onKey = (ev: KeyboardEvent): void => {
      if (ignoreRef.current(ev)) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;

      const now = performance.now();
      const active = pending && now - pending.at <= CHORD_TIMEOUT_MS ? pending.map : mapRef.current;
      pending = null;

      const entry = active[ev.key];
      if (entry === undefined) return;

      if (typeof entry === "function") {
        ev.preventDefault();
        entry(ev);
        return;
      }
      ev.preventDefault();
      pending = { map: entry, at: now };
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [options.enabled]);
}
