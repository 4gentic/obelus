#!/usr/bin/env node
// Enforces the PWA → desktop boundary from docs/plan.md:
//   1. `apps/web/src` must not import any desktop-only package or subpath.
//   2. `packages/repo/src/web` (the Dexie impl) must not reach into the SQLite
//      sibling or Tauri plugins — the web package export stays self-contained
//      so Vite tree-shakes the desktop code out of the PWA bundle.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const WEB_APP_DESKTOP_ONLY = ["@obelus/claude-sidecar", "@obelus/repo/sqlite", "@tauri-apps/"];

// Refused as a bare or deeply-pathed import. The `/browser` subpath alone is
// allowed — see packages/source-render/src/browser.ts for why.
const WEB_APP_SOURCE_RENDER_ALLOWED_SUBPATH = "@obelus/source-render/browser";
const WEB_APP_SOURCE_RENDER_ROOT = "@obelus/source-render";

const WEB_REPO_FORBIDDEN = ["../sqlite", "./sqlite", "@obelus/repo/sqlite", "@tauri-apps/"];

function lsFiles(...patterns) {
  const out = execFileSync("git", ["ls-files", ...patterns], { encoding: "utf8" });
  return out.split("\n").filter(Boolean);
}

const IMPORT_SPEC_RE = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

function* importsOf(contents) {
  for (const match of contents.matchAll(IMPORT_SPEC_RE)) {
    yield match[1];
  }
}

let fail = false;

for (const file of lsFiles("apps/web/src/**/*.ts", "apps/web/src/**/*.tsx")) {
  const contents = readFileSync(file, "utf8");
  for (const spec of importsOf(contents)) {
    for (const name of WEB_APP_DESKTOP_ONLY) {
      if (spec === name || spec.startsWith(`${name}/`) || spec.startsWith(name)) {
        console.error(`[guard:desktop-only] ${file} imports desktop-only '${spec}'`);
        fail = true;
      }
    }
    if (
      (spec === WEB_APP_SOURCE_RENDER_ROOT || spec.startsWith(`${WEB_APP_SOURCE_RENDER_ROOT}/`)) &&
      spec !== WEB_APP_SOURCE_RENDER_ALLOWED_SUBPATH
    ) {
      console.error(
        `[guard:desktop-only] ${file} imports desktop-only '${spec}' — only '${WEB_APP_SOURCE_RENDER_ALLOWED_SUBPATH}' is allowed`,
      );
      fail = true;
    }
  }
}

for (const file of lsFiles("packages/repo/src/web/**/*.ts", "packages/repo/src/web/**/*.tsx")) {
  const contents = readFileSync(file, "utf8");
  for (const spec of importsOf(contents)) {
    for (const name of WEB_REPO_FORBIDDEN) {
      if (spec === name || spec.startsWith(`${name}/`) || spec.startsWith(name)) {
        console.error(
          `[guard:desktop-only] ${file} (web repo impl) reaches desktop-only '${spec}'`,
        );
        fail = true;
      }
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
