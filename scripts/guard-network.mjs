#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const FORBIDDEN = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bnew\s+WebSocket\b/,
  /\bnew\s+EventSource\b/,
  /navigator\.sendBeacon/,
  /navigator\.connection/,
  /importScripts\s*\(\s*['"]https?:/,
  /googletagmanager/,
  /plausible/i,
  /posthog/i,
  /amplitude/i,
  /mixpanel/i,
  /segment\.io/,
];

const ALLOW_PREFIXES = [
  "packages/claude-plugin/",
  "scripts/",
  // Same-origin sample-PDF fetch; SW-precached, no network egress.
  "apps/web/src/lib/sample-paper.ts",
];

const out = execFileSync(
  "git",
  ["ls-files", "apps/**/*.ts", "apps/**/*.tsx", "packages/**/*.ts", "packages/**/*.tsx"],
  { encoding: "utf8" },
);

const tracked = out.split("\n").filter(Boolean);

let fail = false;
for (const file of tracked) {
  if (ALLOW_PREFIXES.some((p) => file.startsWith(p))) continue;
  const contents = readFileSync(file, "utf8");
  for (const rx of FORBIDDEN) {
    if (rx.test(contents)) {
      console.error(`[guard:network] ${file} matches ${rx}`);
      fail = true;
    }
  }
}

if (fail) {
  console.error("\nForbidden network-related strings found outside allowed paths.");
  console.error("Obelus is fully offline; justify any exception in the allow-list.");
  process.exit(1);
}

// biome-ignore lint/suspicious/noConsole: this is a CLI script; success message goes to stdout.
console.log("[guard:network] clean");
