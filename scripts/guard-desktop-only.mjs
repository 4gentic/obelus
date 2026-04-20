#!/usr/bin/env node
// Enforces the PWA → desktop boundary from docs/plan.md:
//   1. `apps/web/src` must not import any desktop-only package or subpath.
//   2. `packages/repo/src/web` (the Dexie impl) must not reach into the SQLite
//      sibling or Tauri plugins — the web package export stays self-contained
//      so Vite tree-shakes the desktop code out of the PWA bundle.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const WEB_APP_DESKTOP_ONLY = [
  "@obelus/claude-sidecar",
  "@obelus/source-render",
  "@obelus/repo/sqlite",
  "@tauri-apps/",
];

const WEB_REPO_FORBIDDEN = ["../sqlite", "./sqlite", "@obelus/repo/sqlite", "@tauri-apps/"];

function lsFiles(...patterns) {
  const out = execFileSync("git", ["ls-files", ...patterns], { encoding: "utf8" });
  return out.split("\n").filter(Boolean);
}

let fail = false;

for (const file of lsFiles("apps/web/src/**/*.ts", "apps/web/src/**/*.tsx")) {
  const contents = readFileSync(file, "utf8");
  for (const name of WEB_APP_DESKTOP_ONLY) {
    if (contents.includes(`"${name}`) || contents.includes(`'${name}`)) {
      console.error(`[guard:desktop-only] ${file} imports desktop-only '${name}'`);
      fail = true;
    }
  }
}

for (const file of lsFiles("packages/repo/src/web/**/*.ts", "packages/repo/src/web/**/*.tsx")) {
  const contents = readFileSync(file, "utf8");
  for (const name of WEB_REPO_FORBIDDEN) {
    if (contents.includes(`"${name}`) || contents.includes(`'${name}`)) {
      console.error(`[guard:desktop-only] ${file} (web repo impl) reaches desktop-only '${name}'`);
      fail = true;
    }
  }
}

if (fail) {
  console.error(
    "\napps/web and packages/repo/src/web must stay offline-pure.",
    "\nDesktop-only capabilities belong in apps/desktop and packages/repo/src/sqlite.",
  );
  process.exit(1);
}

// biome-ignore lint/suspicious/noConsole: this is a CLI script; success message goes to stdout.
console.log("[guard:desktop-only] clean");
