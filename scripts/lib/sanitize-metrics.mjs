// Path sanitiser for committed metrics snapshots — the single source of truth
// for the OSS-readability gate. A capture run threads three real absolute paths
// through the engine's tool inputs and the synthesised boundary events: the
// per-project workspace dir (`$OBELUS_WORKSPACE_DIR`), the paper source tree,
// and the repo/plugin install dir. None may land in `docs/metrics/` — the bar
// refuses a real username, home dir, or hostname in a committed file (CLAUDE.md).
//
// This module rewrites each registered path to the placeholder vocabulary the
// existing baselines use (`<workspace>`, `<obelus-repo>`, `<paper-root>`), then
// sweeps a generic home-dir fallback (`/Users/<name>` / `/home/<name>` →
// `<home>`) so an unregistered path still can't leak a username. Pure and
// dependency-free so `scripts/__tests__/sanitize-metrics.test.mjs` can exercise
// it under `node --test` without `tsx` or an engine spawn. `capture-metrics.mjs`
// is the only runtime consumer.

// Sanitise one already-serialised JSONL line. `replacements` is an ordered
// `[absPath, placeholder][]` — apply longest-prefix-first so a workspace path
// nested under the repo root is not half-rewritten (the caller is responsible
// for ordering, e.g. via `orderReplacements`). After the registered prefixes,
// a catch-all home-dir sweep collapses any surviving `/Users/<name>` /
// `/home/<name>` to `<home>`, stripping through the user segment so a truncated
// tool-input blob that ends mid-path still loses the username. `extraTokens`
// sweeps non-path identity strings (hostname) to `<host>`.
export function sanitizeLine(line, replacements, extraTokens = []) {
  let out = line;
  for (const [abs, placeholder] of replacements) {
    if (!abs) continue;
    out = out.split(abs).join(placeholder);
  }
  out = out.replace(/\/Users\/[^/"\\]+/g, "<home>").replace(/\/home\/[^/"\\]+/g, "<home>");
  // Windows: `C:\Users\<name>\…`. Both single- and double-backslash forms (the
  // latter appears inside JSON-escaped strings).
  out = out
    .replace(/[A-Za-z]:\\\\Users\\\\[^\\"\s]+/g, "<home>")
    .replace(/[A-Za-z]:\\Users\\[^\\"\s]+/g, "<home>");
  for (const token of extraTokens) {
    if (typeof token === "string" && token.length > 0) {
      out = out.split(token).join("<host>");
    }
  }
  return out;
}

// True when a line still leaks a real machine path or a swept identity token.
// The harness asserts this returns false for every line before writing — a
// committed leak is a hard fail, not a warning.
export function leaksMachinePath(line, extraTokens = []) {
  if (/\/Users\/|\/home\/|[A-Za-z]:\\+Users\\+/.test(line)) return true;
  for (const token of extraTokens) {
    if (typeof token === "string" && token.length > 0 && line.includes(token)) return true;
  }
  return false;
}

// Order an `[absPath, placeholder][]` table longest-prefix-first so the most
// specific path wins (a workspace inside app-data inside home is replaced
// before any ancestor). Drops empty/undefined paths.
export function orderReplacements(pairs) {
  return pairs
    .filter(([abs]) => typeof abs === "string" && abs.length > 0)
    .sort((a, b) => b[0].length - a[0].length);
}
