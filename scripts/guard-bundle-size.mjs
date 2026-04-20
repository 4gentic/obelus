#!/usr/bin/env node

// Fails CI if any JS asset exceeds the per-chunk budget, or if the precached
// JS total exceeds the aggregate budget. Budgets are deliberately generous
// right now — the point is to catch regressions (adding a large dep without
// noticing), not to gate normal work. Tighten as the app stabilizes.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const ROOT = "apps/web/dist/assets";
const PER_CHUNK_GZIP_BUDGET = 600 * 1024; // 600 KB per chunk, gzipped
const TOTAL_GZIP_BUDGET = 1200 * 1024; // 1.2 MB across all JS, gzipped

let entries;
try {
  entries = readdirSync(ROOT);
} catch (err) {
  console.error(`[guard:bundle-size] ${ROOT} not found — run pnpm build first.`);
  console.error(String(err));
  process.exit(1);
}

const jsFiles = entries.filter((name) => name.endsWith(".js"));

const rows = jsFiles
  .map((name) => {
    const full = join(ROOT, name);
    const raw = readFileSync(full);
    const gz = gzipSync(raw);
    return { name, rawBytes: statSync(full).size, gzBytes: gz.length };
  })
  .sort((a, b) => b.gzBytes - a.gzBytes);

const fmt = (n) => `${(n / 1024).toFixed(1)} KB`;

let fail = false;
for (const row of rows) {
  const over = row.gzBytes > PER_CHUNK_GZIP_BUDGET;
  const marker = over ? "OVER" : "ok";
  console.log(
    `[guard:bundle-size] ${row.name.padEnd(48)}  ${fmt(row.gzBytes).padStart(10)} gz  ${marker}`,
  );
  if (over) fail = true;
}

const total = rows.reduce((acc, r) => acc + r.gzBytes, 0);
console.log(
  `[guard:bundle-size] total JS (gzipped): ${fmt(total)} (budget ${fmt(TOTAL_GZIP_BUDGET)})`,
);
if (total > TOTAL_GZIP_BUDGET) {
  console.error("[guard:bundle-size] aggregate budget exceeded");
  fail = true;
}

if (fail) {
  console.error(
    "\n[guard:bundle-size] Budget exceeded. Either split the chunk, drop a dep, or raise the budget in scripts/guard-bundle-size.mjs with justification.",
  );
  process.exit(1);
}
console.log("[guard:bundle-size] clean");
