#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Re-emit the canonical JSON Schemas to a temp dir and diff against the two
// committed copies. Catches the case where someone hand-edited
// `schemas/*.schema.json` (or skipped re-running the emitter after a Zod
// change) — the two committed dirs would silently drift apart and the plugin
// would validate against a stale schema.

const repoRoot = resolve(process.cwd());
const emitter = join(repoRoot, "packages/bundle-schema/scripts/emit-json-schema.mjs");
const committedDirs = [
  join(repoRoot, "packages/bundle-schema/schemas"),
  join(repoRoot, "packages/claude-plugin/schemas"),
];
const files = ["bundle-v1.schema.json", "bundle-v2.schema.json", "project-meta.schema.json"];

const tmp = mkdtempSync(join(tmpdir(), "obelus-schema-guard-"));
try {
  execFileSync(process.execPath, [emitter, tmp], { stdio: "inherit" });

  let fail = false;
  for (const file of files) {
    const fresh = readFileSync(join(tmp, file), "utf8");
    for (const dir of committedDirs) {
      const committed = readFileSync(join(dir, file), "utf8");
      if (committed !== fresh) {
        console.error(`[guard:schema-emit] drift in ${join(dir, file)}`);
        fail = true;
      }
    }
  }

  if (fail) {
    console.error("\nA committed JSON Schema differs from a fresh emit.");
    console.error("Run `pnpm -C packages/bundle-schema build` and commit the result.");
    process.exit(1);
  }

  // biome-ignore lint/suspicious/noConsole: CLI script; success message to stdout.
  console.log("[guard:schema-emit] clean");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
