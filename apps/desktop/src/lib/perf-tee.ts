import { invoke } from "@tauri-apps/api/core";

// Mirror tagged `console.info` calls (e.g. `[write-perf]`, `[review-timing]`,
// `[phase]`, `[ingest-plan]`, `[review-session]`, `[apply]`) from the WebView
// to the Rust process's stderr so a single `pnpm dev:desktop 2>&1 | tee
// /tmp/obelus-perf.log` capture has both streams interleaved by wall-clock.
//
// Without this, JS-side timing logs live only in the WebView devtools and the
// only way to compare against the Rust-side `[claude-session]` log is to copy
// console output by hand. Forwarded fire-and-forget — a slow or failed `invoke`
// must not stall the UI.
const TAGGED_FIRST_ARG = /^\[[a-z][a-z0-9:-]*\]$/i;

let installed = false;

export function installPerfTee(): void {
  if (installed) return;
  installed = true;
  const original = console.info.bind(console);
  console.info = (...args: unknown[]): void => {
    original(...args);
    if (typeof args[0] !== "string" || !TAGGED_FIRST_ARG.test(args[0])) return;
    let line: string;
    try {
      line = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    } catch {
      // Circular structures would throw on stringify; the devtools side still
      // got the structured object, so dropping the mirrored copy is fine.
      return;
    }
    void invoke("perf_log", { line }).catch(() => undefined);
  };
}
